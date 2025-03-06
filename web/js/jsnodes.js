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
    chainCallback(nodeType.prototype, "onCreated", function() {
        const that = this;
        let models = {};
        
        // Cache original widget draw function to modify behavior
        const origDrawWidgetValue = LiteGraph.ContextMenu.prototype.drawWidgetValue;
        
        // Add a widget to display the full path (read-only)
        const fullPathWidget = this.addWidget("text", "Full Path", "Select a model to see its path", null);
        fullPathWidget.disabled = true; // Make it read-only
        
        // Create select element for filters
        this.widgets.forEach((w, i) => {
            if (w.name === 'filter') {
                w.customTips = "Click to filter models";
                w.options = {};
                w.combo = true;
                w.descriptor = "Click to filter models";
                
                // Modify the draw function to show the dropdown correctly
                w.draw = function(ctx, node, width, pos, height) {
                    if (!ctx) {
                        return;
                    }
                    return origDrawWidgetValue.call(that, ctx, this, width, pos, height);
                };
                
                // Handle filter selection
                w.callback = function(value, options, e, event) {
                    if (value) {
                        // Implementation depends on how the filters are organized in your ComfyUI fork
                        // This is a simplified example
                        let currentModelName = that.widgets.find(w => w.name === 'ckpt_name').value;
                        let filterType = value.toLowerCase();
                        
                        if (filterType === "custom") {
                            // Display custom models
                            that.widgets.find(w => w.name === 'custom').onClicked?.call(that, w);
                        } else if (filterType === "flux") {
                            // Display flux models
                            that.widgets.find(w => w.name === 'flux').onClicked?.call(that, w);
                        } else if (filterType === "hunyuan3d") {
                            // Display hunyuan3d models
                            that.widgets.find(w => w.name === 'hunyuan3d').onClicked?.call(that, w);
                        } else if (filterType === "sdxl") {
                            // Display SDXL models
                            that.widgets.find(w => w.name === 'sdxl').onClicked?.call(that, w);
                        } else if (filterType === "v1") {
                            // Display v1 models
                            that.widgets.find(w => w.name === 'v1').onClicked?.call(that, w);
                        }
                    }
                };
            }
            
            // Add click handlers for category filters
            if (['custom', 'flux', 'hunyuan3d', 'sdxl', 'v1'].includes(w.name)) {
                w.hidden = true; // Hide these widgets as they're just used for filtering
                w.onClicked = function(widget) {
                    const ckptWidget = that.widgets.find(w => w.name === 'ckpt_name');
                    
                    // Filter models based on category
                    // This will require a different implementation depending on your model naming convention
                    // Here we simply filter by comparing part of the model filename
                    const filteredModels = ckptWidget.options.values.filter(model => {
                        if (widget.name === 'custom') {
                            return model.startsWith("custom_");
                        } else if (widget.name === 'flux') {
                            return model.includes("flux");
                        } else if (widget.name === 'hunyuan3d') {
                            return model.includes("hunyuan");
                        } else if (widget.name === 'sdxl') {
                            return model.includes("sdxl");
                        } else if (widget.name === 'v1') {
                            return model.includes("v1") || model.includes("sd-v1");
                        }
                        return true;
                    });
                    
                    // Update the dropdown options
                    ckptWidget.options.values = filteredModels;
                    if (filteredModels.length > 0) {
                        // Select first model in filtered list if current selection isn't in the filtered list
                        if (!filteredModels.includes(ckptWidget.value)) {
                            ckptWidget.value = filteredModels[0];
                            // Trigger the update
                            ckptWidget.callback(ckptWidget.value);
                        }
                    }
                    
                    // Update filter display
                    that.widgets.find(w => w.name === 'filter').value = widget.name;
                };
            }
            
            // Add handler for ckpt_name selection
            if (w.name === 'ckpt_name') {
                w.callback = function(value) {
                    if (value) {
                        // When a model is selected
                        // Get the full path
                        const modelPath = value; // The actual path is resolved on the backend
                        
                        // Update outputs
                        that.outputs[0].name = "model_path: " + modelPath;
                        that.outputs[1].name = "model_name: " + value;
                        
                        // Store values for serialization
                        that._filePath = modelPath;
                        that._fileName = value;
                        
                        // Request the full path from the server
                        fetch(`/hy3d/model_path?name=${encodeURIComponent(value)}`)
                            .then(response => response.json())
                            .then(data => {
                                if (data.path) {
                                    // Update the full path widget with the actual path
                                    const fullPathWidget = that.widgets.find(w => w.name === 'Full Path');
                                    if (fullPathWidget) {
                                        fullPathWidget.value = data.path;
                                    }
                                    // Store the full path
                                    that._fullPath = data.path;
                                }
                            })
                            .catch(error => {
                                console.error("Error fetching model path:", error);
                            });
                    }
                };
            }
        });
    });
    
    // Handle serialization
    chainCallback(nodeType.prototype, "onSerialize", function(o) {
        if (this._filePath) o.filePath = this._filePath;
        if (this._fileName) o.fileName = this._fileName;
        if (this._fullPath) o.fullPath = this._fullPath;
    });
    
    // Handle deserialization
    chainCallback(nodeType.prototype, "onConfigure", function(o) {
        if (o.filePath) this._filePath = o.filePath;
        if (o.fileName) this._fileName = o.fileName;
        if (o.fullPath) this._fullPath = o.fullPath;
        
        // Update widget values
        setTimeout(() => {
            const ckptWidget = this.widgets.find(w => w.name === 'ckpt_name');
            if (ckptWidget && this._fileName) {
                ckptWidget.value = this._fileName;
            }
            
            // Update the full path widget if available
            const fullPathWidget = this.widgets.find(w => w.name === 'Full Path');
            if (fullPathWidget && this._fullPath) {
                fullPathWidget.value = this._fullPath;
            }
            
            // Update outputs
            if (this._filePath) this.outputs[0].name = "model_path: " + this._filePath;
            if (this._fileName) this.outputs[1].name = "model_name: " + this._fileName;
        }, 100);
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