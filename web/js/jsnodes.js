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
        const that = this;
        
        // Estado interno
        this._currentPath = "";
        this._selectedFilePath = "";
        this._selectedFileName = "";
        
        // Crear el contenedor del explorador de archivos
        const explorerContainer = document.createElement("div");
        explorerContainer.className = "hy3d-file-explorer";
        explorerContainer.style.display = "none";
        explorerContainer.style.position = "absolute";
        explorerContainer.style.width = "500px";
        explorerContainer.style.maxHeight = "400px";
        explorerContainer.style.overflowY = "auto";
        explorerContainer.style.backgroundColor = "#2a2a2a";
        explorerContainer.style.border = "1px solid #444";
        explorerContainer.style.borderRadius = "5px";
        explorerContainer.style.zIndex = "1000";
        explorerContainer.style.padding = "10px";
        explorerContainer.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
        
        document.body.appendChild(explorerContainer);
        
        // Añadir widgets
        const directoryWidget = this.addWidget("text", "Directory", "", (value) => {
            this._currentPath = value;
        });
        
        const selectedFileWidget = this.addWidget("text", "Selected File", "No file selected", null);
        selectedFileWidget.disabled = true;
        
        const selectedPathWidget = this.addWidget("text", "Full Path", "", null);
        selectedPathWidget.disabled = true;
        
        // Añadir botón para abrir explorador
        const browseButton = this.addWidget("button", "Browse Files", null, async () => {
            // Posicionar el explorador cerca del nodo
            const nodeRect = this.getBounding();
            if (nodeRect) {
                explorerContainer.style.left = (nodeRect.x + nodeRect.width + 10) + "px";
                explorerContainer.style.top = nodeRect.y + "px";
            }
            
            // Mostrar el explorador
            explorerContainer.style.display = "block";
            
            // Cargar el directorio inicial
            await loadDirectory(this._currentPath || "", this.widgets.find(w => w.name === "model_type").value);
        });
        
        // Función para cargar un directorio
        async function loadDirectory(path, modelType = "all") {
            try {
                explorerContainer.innerHTML = "<div style='padding: 10px;'>Loading...</div>";
                
                // Hacer la petición al endpoint
                const response = await fetch(`/hy3d/list_dirs?path=${encodeURIComponent(path)}&model_type=${encodeURIComponent(modelType)}`);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Error ${response.status}: ${errorText}`);
                }
                
                const data = await response.json();
                that._currentPath = data.current_path;
                directoryWidget.value = data.current_path;
                
                // Resetear el contenedor
                explorerContainer.innerHTML = "";
                
                // Añadir encabezado con ruta actual
                const header = document.createElement("div");
                header.style.padding = "5px";
                header.style.marginBottom = "10px";
                header.style.borderBottom = "1px solid #444";
                header.style.fontWeight = "bold";
                header.textContent = `Current directory: ${data.current_path || "/"}`;
                explorerContainer.appendChild(header);
                
                // Añadir botón para ir al directorio padre
                if (data.parent_path && data.parent_path !== data.current_path) {
                    const parentDir = document.createElement("div");
                    parentDir.className = "hy3d-directory-item";
                    parentDir.innerHTML = "📁 ../ (Parent Directory)";
                    parentDir.style.padding = "5px";
                    parentDir.style.cursor = "pointer";
                    parentDir.style.borderRadius = "3px";
                    parentDir.style.marginBottom = "2px";
                    parentDir.addEventListener("mouseover", () => {
                        parentDir.style.backgroundColor = "#444";
                    });
                    parentDir.addEventListener("mouseout", () => {
                        parentDir.style.backgroundColor = "transparent";
                    });
                    parentDir.addEventListener("click", () => {
                        loadDirectory(data.parent_path, modelType);
                    });
                    explorerContainer.appendChild(parentDir);
                }
                
                // Añadir directorios
                data.directories.forEach(dir => {
                    const dirElement = document.createElement("div");
                    dirElement.className = "hy3d-directory-item";
                    dirElement.innerHTML = `📁 ${dir.name}`;
                    dirElement.style.padding = "5px";
                    dirElement.style.cursor = "pointer";
                    dirElement.style.borderRadius = "3px";
                    dirElement.style.marginBottom = "2px";
                    dirElement.addEventListener("mouseover", () => {
                        dirElement.style.backgroundColor = "#444";
                    });
                    dirElement.addEventListener("mouseout", () => {
                        dirElement.style.backgroundColor = "transparent";
                    });
                    dirElement.addEventListener("click", () => {
                        loadDirectory(dir.path, modelType);
                    });
                    explorerContainer.appendChild(dirElement);
                });
                
                // Añadir archivos
                data.files.forEach(file => {
                    const fileElement = document.createElement("div");
                    fileElement.className = "hy3d-file-item";
                    fileElement.innerHTML = `📄 ${file.name}`;
                    fileElement.style.padding = "5px";
                    fileElement.style.cursor = "pointer";
                    fileElement.style.borderRadius = "3px";
                    fileElement.style.marginBottom = "2px";
                    fileElement.addEventListener("mouseover", () => {
                        fileElement.style.backgroundColor = "#444";
                    });
                    fileElement.addEventListener("mouseout", () => {
                        fileElement.style.backgroundColor = "transparent";
                    });
                    fileElement.addEventListener("click", () => {
                        // Seleccionar este archivo
                        that._selectedFilePath = file.path;
                        that._selectedFileName = file.name;
                        
                        // Actualizar widgets
                        selectedFileWidget.value = file.name;
                        selectedPathWidget.value = file.path;
                        
                        // Actualizar outputs
                        that.outputs[0].name = "model_path: " + file.path;
                        that.outputs[1].name = "model_name: " + file.name;
                        
                        // Cerrar el explorador
                        explorerContainer.style.display = "none";
                        
                        // Notificar que se ha cambiado la salida para que se actualice la interfaz
                        that.setDirtyCanvas(true, false);
                    });
                    explorerContainer.appendChild(fileElement);
                });
                
                // Si no hay directorios ni archivos
                if (data.directories.length === 0 && data.files.length === 0) {
                    const emptyMsg = document.createElement("div");
                    emptyMsg.style.padding = "10px";
                    emptyMsg.style.fontStyle = "italic";
                    emptyMsg.textContent = "Empty directory";
                    explorerContainer.appendChild(emptyMsg);
                }
                
                // Añadir botón para cerrar
                const closeButton = document.createElement("button");
                closeButton.textContent = "Close";
                closeButton.style.marginTop = "10px";
                closeButton.style.padding = "5px 10px";
                closeButton.style.cursor = "pointer";
                closeButton.addEventListener("click", () => {
                    explorerContainer.style.display = "none";
                });
                explorerContainer.appendChild(closeButton);
                
            } catch (error) {
                console.error("Error loading directory:", error);
                explorerContainer.innerHTML = `<div style="color: red; padding: 10px;">Error: ${error.message}</div>`;
                
                // Añadir botón para cerrar
                const closeButton = document.createElement("button");
                closeButton.textContent = "Close";
                closeButton.style.marginTop = "10px";
                closeButton.style.padding = "5px 10px";
                closeButton.style.cursor = "pointer";
                closeButton.addEventListener("click", () => {
                    explorerContainer.style.display = "none";
                });
                explorerContainer.appendChild(closeButton);
            }
        }
        
        // Cerrar explorador al hacer clic fuera
        document.addEventListener("click", (e) => {
            if (!explorerContainer.contains(e.target) && 
                !browseButton.element.contains(e.target) && 
                explorerContainer.style.display === "block") {
                explorerContainer.style.display = "none";
            }
        });
        
        // Eliminar el explorador cuando se elimine el nodo
        this.onRemoved = () => {
            if (explorerContainer && explorerContainer.parentNode) {
                explorerContainer.parentNode.removeChild(explorerContainer);
            }
        };
        
        // Personalizar las salidas
        this.outputs[0].name = "model_path: None";
        this.outputs[1].name = "model_name: None";
    });
    
    // Serialización
    chainCallback(nodeType.prototype, "onSerialize", function(o) {
        o.selectedFilePath = this._selectedFilePath;
        o.selectedFileName = this._selectedFileName;
        o.currentPath = this._currentPath;
    });
    
    // Deserialización
    chainCallback(nodeType.prototype, "onConfigure", function(o) {
        if (o.selectedFilePath) this._selectedFilePath = o.selectedFilePath;
        if (o.selectedFileName) this._selectedFileName = o.selectedFileName;
        if (o.currentPath) this._currentPath = o.currentPath;
        
        // Actualizar widgets
        setTimeout(() => {
            const directoryWidget = this.widgets.find(w => w.name === "Directory");
            if (directoryWidget && this._currentPath) {
                directoryWidget.value = this._currentPath;
            }
            
            const selectedFileWidget = this.widgets.find(w => w.name === "Selected File");
            if (selectedFileWidget && this._selectedFileName) {
                selectedFileWidget.value = this._selectedFileName;
            }
            
            const selectedPathWidget = this.widgets.find(w => w.name === "Full Path");
            if (selectedPathWidget && this._selectedFilePath) {
                selectedPathWidget.value = this._selectedFilePath;
            }
            
            // Actualizar outputs
            if (this._selectedFilePath) {
                this.outputs[0].name = "model_path: " + this._selectedFilePath;
            }
            if (this._selectedFileName) {
                this.outputs[1].name = "model_name: " + this._selectedFileName;
            }
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