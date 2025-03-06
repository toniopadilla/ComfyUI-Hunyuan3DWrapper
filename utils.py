import importlib.metadata
import torch
import logging
import numpy as np
import trimesh
import os
import traceback

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
log = logging.getLogger(__name__)

def check_diffusers_version():
    try:
        version = importlib.metadata.version('diffusers')
        required_version = '0.31.0'
        if version < required_version:
            raise AssertionError(f"diffusers version {version} is installed, but version {required_version} or higher is required.")
    except importlib.metadata.PackageNotFoundError:
        raise AssertionError("diffusers is not installed.")

def print_memory(device):
    memory = torch.cuda.memory_allocated(device) / 1024**3
    max_memory = torch.cuda.max_memory_allocated(device) / 1024**3
    max_reserved = torch.cuda.max_memory_reserved(device) / 1024**3
    log.info(f"Allocated memory: {memory=:.3f} GB")
    log.info(f"Max allocated memory: {max_memory=:.3f} GB")
    log.info(f"Max reserved memory: {max_reserved=:.3f} GB")
    #memory_summary = torch.cuda.memory_summary(device=device, abbreviated=False)
    #log.info(f"Memory Summary:\n{memory_summary}")

def rotate_mesh_matrix(mesh, angle, axis='z'):
    # Create rotation matrix
    matrix = trimesh.transformations.rotation_matrix(
        angle=np.radians(angle),  # Convert degrees to radians
        direction={
            'x': [1, 0, 0],
            'y': [0, 1, 0],
            'z': [0, 0, 1]
        }[axis]
    )
    return mesh.apply_transform(matrix)
        
def intrinsics_to_projection(
        intrinsics: torch.Tensor,
        near: float,
        far: float,
    ) -> torch.Tensor:
    """
    OpenCV intrinsics to OpenGL perspective matrix

    Args:
        intrinsics (torch.Tensor): [3, 3] OpenCV intrinsics matrix
        near (float): near plane to clip
        far (float): far plane to clip
    Returns:
        (torch.Tensor): [4, 4] OpenGL perspective matrix
    """
    fx, fy = intrinsics[0, 0], intrinsics[1, 1]
    cx, cy = intrinsics[0, 2], intrinsics[1, 2]
    ret = torch.zeros((4, 4), dtype=intrinsics.dtype, device=intrinsics.device)
    ret[0, 0] = 2 * fx
    ret[1, 1] = 2 * fy
    ret[0, 2] = 2 * cx - 1
    ret[1, 2] = - 2 * cy + 1
    ret[2, 2] = far / (far - near)
    ret[2, 3] = near * far / (near - far)
    ret[3, 2] = 1.
    return ret

def yaw_pitch_r_fov_to_extrinsics_intrinsics(yaws, pitchs, rs, fovs, aspect_ratio=1.0, pan_x=0.0, pan_y=0.0):
    import utils3d
    is_list = isinstance(yaws, list)
    if not is_list:
        yaws = [yaws]
        pitchs = [pitchs]
    if not isinstance(rs, list):
        rs = [rs] * len(yaws)
    if not isinstance(fovs, list):
        fovs = [fovs] * len(yaws)

    MIN_DISTANCE = 1e-6
    rs = [max(r, MIN_DISTANCE) for r in rs]

    extrinsics = []
    intrinsics = []
    for yaw, pitch, r, fov in zip(yaws, pitchs, rs, fovs):
        fov = torch.deg2rad(torch.tensor(float(fov))).cuda()
        fov_y = fov
        fov_x = 2.0 * torch.atan(torch.tan(fov_y * 0.5) * aspect_ratio)
        
        yaw = torch.tensor(float(yaw)).cuda()
        pitch = torch.tensor(float(pitch)).cuda()
        orig = torch.tensor([
            torch.sin(yaw) * torch.cos(pitch),
            torch.cos(yaw) * torch.cos(pitch),
            torch.sin(pitch),
        ]).cuda() * r

        # Calculate camera right vector
        right = torch.tensor([
            torch.cos(yaw),
            -torch.sin(yaw),
            0.0
        ]).cuda()

        # Calculate camera up vector after pitch
        up = torch.tensor([
            torch.sin(yaw) * torch.sin(pitch),
            torch.cos(yaw) * torch.sin(pitch),
            -torch.cos(pitch)
        ]).cuda()

        # Apply panning in camera space
        target = torch.tensor([0.0, 0.0, 0.0]).float().cuda()
        target = target + right * pan_x + up * pan_y
        up_vector = torch.tensor([0, 0, 1]).float().cuda()

        extr = utils3d.torch.extrinsics_look_at(orig, target, up_vector)
        intr = utils3d.torch.intrinsics_from_fov_xy(fov_x, fov_y)
        extrinsics.append(extr)
        intrinsics.append(intr)
    if not is_list:
        extrinsics = extrinsics[0]
        intrinsics = intrinsics[0]
    return extrinsics, intrinsics

# Add this function to register the API endpoints for directory listing
def register_api_endpoints(server):
    """Register API endpoints for the Hunyuan3D extension."""
    
    @server.route("/hy3d/list_dirs", methods=["GET"])
    def list_directories():
        try:
            path = server.args.get("path", "")
            model_type = server.args.get("model_type", "all")
            
            # Sanitize path
            path = os.path.normpath(path)
            
            # Handle empty path: find root directories
            if not path:
                # Try to find some useful starting directories
                root_dirs = []
                
                # Add models directory if exists
                try:
                    import folder_paths
                    models_dir = os.path.join(folder_paths.models_dir)
                    if os.path.exists(models_dir) and os.path.isdir(models_dir):
                        root_dirs.append({"name": "models", "path": models_dir})
                except:
                    pass
                
                # Add current directory and parent
                root_dirs.append({"name": "Current directory", "path": "."})
                root_dirs.append({"name": "Parent directory", "path": ".."})
                
                # Add root directories in Linux/Mac
                if os.path.exists("/"):
                    try:
                        for item in os.listdir("/"):
                            item_path = os.path.join("/", item)
                            if os.path.isdir(item_path):
                                root_dirs.append({"name": item, "path": item_path})
                    except:
                        pass
                
                # Add drives in Windows
                if os.name == 'nt':
                    import string
                    drives = []
                    for drive in string.ascii_uppercase:
                        if os.path.exists(f"{drive}:\\"):
                            root_dirs.append({"name": f"{drive}:", "path": f"{drive}:\\"})
                
                return {
                    "current_path": "",
                    "parent_path": "",
                    "directories": root_dirs,
                    "files": []
                }
            
            # Get full path
            full_path = os.path.abspath(path)
            
            # Check if path exists
            if not os.path.exists(full_path) or not os.path.isdir(full_path):
                return {"error": "Path does not exist or is not a directory"}, 404
            
            # Get parent path
            parent_path = os.path.dirname(full_path)
            
            # Get directories and files
            directories = []
            files = []
            
            # Define valid extensions based on model_type
            valid_extensions = []
            if model_type == "safetensors" or model_type == "all":
                valid_extensions.append(".safetensors")
            if model_type == "ckpt" or model_type == "all":
                valid_extensions.append(".ckpt")
            
            try:
                for item in os.listdir(full_path):
                    item_path = os.path.join(full_path, item)
                    
                    # Add directories
                    if os.path.isdir(item_path):
                        directories.append({
                            "name": item,
                            "path": item_path
                        })
                    # Add files with valid extensions
                    elif os.path.isfile(item_path):
                        _, ext = os.path.splitext(item)
                        if not valid_extensions or ext.lower() in valid_extensions:
                            try:
                                files.append({
                                    "name": item,
                                    "path": item_path,
                                    "size": os.path.getsize(item_path),
                                    "modified": os.path.getmtime(item_path)
                                })
                            except:
                                # If we can't get size or mtime, still include the file
                                files.append({
                                    "name": item,
                                    "path": item_path
                                })
            except Exception as e:
                return {"error": f"Error reading directory: {str(e)}"}, 500
            
            return {
                "current_path": full_path,
                "parent_path": parent_path,
                "directories": sorted(directories, key=lambda d: d["name"]),
                "files": sorted(files, key=lambda f: f["name"])
            }
        except Exception as e:
            log.error(f"Error in list_directories: {str(e)}")
            return {"error": str(e)}, 500
    
    @server.route("/hy3d/model_path", methods=["GET"])
    def get_model_path():
        try:
            model_name = server.args.get("name", "")
            if not model_name:
                return {"error": "No model name provided"}, 400
            
            # Get the full path from folder_paths
            import folder_paths
            full_path = folder_paths.get_full_path("diffusion_models", model_name)
            
            if not full_path or not os.path.exists(full_path):
                return {"error": "Model not found"}, 404
                
            return {
                "name": model_name,
                "path": full_path
            }
        except Exception as e:
            log.error(f"Error in get_model_path: {str(e)}")
            return {"error": str(e)}, 500
