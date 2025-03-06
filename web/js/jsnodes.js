import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
	name: "HY3D.jsnodes",
	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		
		if(!nodeData?.category?.startsWith("Hunyuan3DWrapper")) {
			return;
		  }
		switch (nodeData.name) {	
			case "Hy3DMeshInfo":
				const onHy3DMeshInfoConnectInput = nodeType.prototype.onConnectInput;
				nodeType.prototype.onConnectInput = function (targetSlot, type, output, originNode, originSlot) {
					const v = onHy3DMeshInfoConnectInput? onHy3DMeshInfoConnectInput.apply(this, arguments): undefined
					this.outputs[1]["name"] = "vertices"
					this.outputs[2]["name"] = "faces" 
					return v;
				}
				const onHy3DMeshInfoExecuted = nodeType.prototype.onExecuted;
				nodeType.prototype.onExecuted = function(message) {
					console.log(message)
					const r = onHy3DMeshInfoExecuted? onHy3DMeshInfoExecuted.apply(this,arguments): undefined
					let values = message["text"].toString().split('x');
					this.outputs[1]["name"] = values[0] + "   vertices"
					this.outputs[2]["name"] = values[1] + "     faces" 
					return r
				}
				break;
			case "Hy3DUploadMesh":
				addUploadWidget(nodeType, nodeData, "mesh");
				break;
			case "Hy3DModelFilePath":
				addModelFilePathWidget(nodeType, nodeData);
				break;
		}	
		
	},
});

//file upload code from VHS nodes: https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
async function uploadFile(file) {
    //TODO: Add uploaded file to cache with Cache.put()?
    try {
        // Wrap file in formdata so it includes filename
        const body = new FormData();
        const i = file.webkitRelativePath.lastIndexOf('/');
        const subfolder = file.webkitRelativePath.slice(0,i+1)
        const new_file = new File([file], file.name, {
            type: file.type,
            lastModified: file.lastModified,
        });
        body.append("image", new_file);
        if (i > 0) {
            body.append("subfolder", subfolder);
        }
        const resp = await api.fetchApi("/upload/image", {
            method: "POST",
            body,
        });

        if (resp.status === 200) {
            return resp
        } else {
            alert(resp.status + " - " + resp.statusText);
        }
    } catch (error) {
        alert(error);
    }
}

// Fetch directories from the server
async function fetchDirectories(path = "") {
    try {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        const response = await api.fetchApi(`/hy3d/list_dirs${query}`);
        if (response.status === 200) {
            return await response.json();
        } else {
            console.error("Error fetching directories:", response.statusText);
            return { directories: [], files: [] };
        }
    } catch (error) {
        console.error("Error fetching directories:", error);
        return { directories: [], files: [] };
    }
}

function addModelFilePathWidget(nodeType, nodeData) {
    chainCallback(nodeType.prototype, "onNodeCreated", function() {
        // Create file input element
        const fileInput = document.createElement("input");
        Object.assign(fileInput, {
            type: "file",
            accept: ".safetensors,.ckpt,application/octet-stream",
            style: "display: none",
            onchange: async () => {
                if (fileInput.files.length) {
                    const filePath = fileInput.files[0].path;
                    const fileName = fileInput.files[0].name;
                    
                    // Update path widget with the selected file path
                    pathWidget.value = filePath;
                    
                    // Update the file name widget
                    fileNameWidget.value = fileName;
                    
                    // Update outputs
                    this.outputs[0].name = "model_path: " + filePath;
                    this.outputs[1].name = "model_name: " + fileName;
                    
                    // Store values for serialization
                    this._filePath = filePath;
                    this._fileName = fileName;
                    
                    // Trigger an update
                    if (pathWidget.callback) {
                        pathWidget.callback(filePath);
                    }
                }
            }
        });
        
        document.body.append(fileInput);
        
        // Add widget for displaying and allowing manual entry of file path
        const pathWidget = this.addWidget("text", "Model Path", "", (value) => {
            this._filePath = value;
            this.outputs[0].name = "model_path: " + value;
        });
        
        // Add widget for displaying file name
        const fileNameWidget = this.addWidget("text", "File Name", "No file selected", (value) => {
            this._fileName = value;
            this.outputs[1].name = "model_name: " + value;
        });
        
        // Add button to open file explorer
        const browseButton = this.addWidget("button", "Browse Files", null, () => {
            // Clear the active click event
            app.canvas.node_widget = null;
            fileInput.click();
        });
        
        // Store the widgets for easy access
        this._pathWidget = pathWidget;
        this._fileNameWidget = fileNameWidget;
        
        // Customize output names
        this.outputs[0].name = "model_path: None";
        this.outputs[1].name = "model_name: None";
        
        // Setup cleanup
        chainCallback(this, "onRemoved", () => {
            fileInput?.remove();
        });
        
        // Handle serialization
        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function() {
            const data = onSerialize ? onSerialize.apply(this) : {};
            data.filePath = this._filePath;
            data.fileName = this._fileName;
            return data;
        };
        
        // Handle deserialization
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(info) {
            if (onConfigure) {
                onConfigure.apply(this, arguments);
            }
            
            if (info.filePath) {
                this._filePath = info.filePath;
                this._pathWidget.value = info.filePath;
                this.outputs[0].name = "model_path: " + info.filePath;
            }
            
            if (info.fileName) {
                this._fileName = info.fileName;
                this._fileNameWidget.value = info.fileName;
                this.outputs[1].name = "model_name: " + info.fileName;
            }
        };
    });
}

function addUploadWidget(nodeType, nodeData, widgetName) {
    chainCallback(nodeType.prototype, "onNodeCreated", function() {
        const pathWidget = this.widgets.find((w) => w.name === widgetName);
        const fileInput = document.createElement("input");
        chainCallback(this, "onRemoved", () => {
            fileInput?.remove();
        });
    	
		Object.assign(fileInput, {
			type: "file",
			accept: ".obj,.glb,.gltf,.stl,.3mf,.ply,model/obj,model/gltf-binary,model/gltf+json,application/vnd.ms-pki.stl,application/x-stl,application/vnd.ms-package.3dmanufacturing-3dmodel+xml,application/x-ply,application/ply",
			style: "display: none",
			onchange: async () => {
				if (fileInput.files.length) {
					let resp = await uploadFile(fileInput.files[0])
					if (resp.status != 200) {
						//upload failed and file can not be added to options
						return;
					}
					const filename = (await resp.json()).name;
					pathWidget.options.values.push(filename);
					pathWidget.value = filename;
					if (pathWidget.callback) {
						pathWidget.callback(filename)
					}
				}
			},
		});
        console.log(this)
        document.body.append(fileInput);
        let uploadWidget = this.addWidget("button", "choose glb file to upload", "image", () => {
            //clear the active click event
            app.canvas.node_widget = null

            fileInput.click();
        });
        uploadWidget.options.serialize = false;
    });
}

function chainCallback(object, property, callback) {
    if (object == undefined) {
        //This should not happen.
        console.error("Tried to add callback to non-existant object")
        return;
    }
    if (property in object && object[property]) {
        const callback_orig = object[property]
        object[property] = function () {
            const r = callback_orig.apply(this, arguments);
            callback.apply(this, arguments);
            return r
        };
    } else {
        object[property] = callback;
    }
}