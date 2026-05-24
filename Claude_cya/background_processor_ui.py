#!/usr/bin/env python3
"""
Ask-Marvin Background Processor UI
Processes one folder at a time, marks complete by adding 'x' prefix
"""

import os
import rawpy
import numpy as np
import cv2
from PIL import Image
from pathlib import Path
import json
import shutil

class BackgroundProcessorUI:
    def __init__(self, work_dir):
        self.work_dir = Path(work_dir)
        
        # Source files on external drive
        self.base_path = Path("/Volumes/Marvin/CyanoVerse_Source_Files")
        self.backgrounds_raw = self.base_path / "Backgrounds_Raw"
        
        # Working directories
        self.preview_dir = self.work_dir / "background_previews"
        self.preview_dir.mkdir(parents=True, exist_ok=True)
        
        self.processed_dir = self.work_dir / "processed_backgrounds"
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        
    def find_unprocessed_folders(self):
        """Find folders without 'x' prefix"""
        unprocessed = []
        for item in self.backgrounds_raw.iterdir():
            if item.is_dir() and not item.name.startswith('x'):
                unprocessed.append(item)
        return sorted(unprocessed)
    
    def convert_cr2_to_png(self, cr2_path, output_path):
        """Convert CR2 to PNG"""
        print(f"  Converting {cr2_path.name}...")
        with rawpy.imread(str(cr2_path)) as raw:
            rgb = raw.postprocess(
                use_camera_wb=True,
                output_bps=8,
                no_auto_bright=False,
                bright=1.0
            )
        
        img = Image.fromarray(rgb)
        max_size = 1920
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        img.save(output_path, "PNG")
        return output_path
    
    def process_folder(self, folder_path):
        """Process a folder and convert all CR2s to PNGs"""
        print(f"\nProcessing folder: {folder_path.name}")
        
        cr2_files = sorted(folder_path.glob("*.CR2"))
        
        if not cr2_files:
            print("  No CR2 files found!")
            return None
        
        converted_images = []
        for cr2_file in cr2_files:
            output_name = f"{folder_path.name}_{cr2_file.stem}.png"
            output_path = self.preview_dir / output_name
            
            self.convert_cr2_to_png(cr2_file, output_path)
            
            converted_images.append({
                'original': cr2_file.name,
                'preview': output_name,
                'source_path': str(cr2_file)
            })
        
        return {
            'folder': folder_path.name,
            'folder_path': str(folder_path),
            'images': converted_images
        }
    
    def create_folder_selection_page(self, folders, folder_results):
        """Create a page to select which folder to process"""
        html_path = self.work_dir / "select_folder.html"
        
        html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Select Folder to Process</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 40px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }
        
        h1 {
            color: #4a9eff;
            margin-bottom: 20px;
        }
        
        .instructions {
            background: #2a4a2a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 40px;
            border-left: 4px solid #4a9eff;
            max-width: 600px;
        }
        
        .folder-list {
            display: flex;
            flex-direction: column;
            gap: 15px;
            max-width: 600px;
            width: 100%;
        }
        
        .folder-button {
            background: #333;
            border: 2px solid #4a9eff;
            color: #e0e0e0;
            padding: 20px 30px;
            font-size: 18px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
        }
        
        .folder-button:hover {
            background: #4a9eff;
            color: white;
            transform: translateX(10px);
        }
        
        .folder-name {
            font-weight: bold;
            font-size: 20px;
            margin-bottom: 5px;
        }
        
        .folder-info {
            font-size: 14px;
            color: #aaa;
        }
        
        .no-folders {
            background: #3a2a2a;
            padding: 30px;
            border-radius: 8px;
            border-left: 4px solid #f92672;
            text-align: center;
        }
    </style>
</head>
<body>
    <h1>🗂️ Select Folder to Process</h1>
    
    <div class="instructions">
        <h2 style="margin-bottom: 10px; color: #66d9ef;">Instructions:</h2>
        <ul style="margin-left: 20px;">
            <li>Select a folder to process its background images</li>
            <li>When finished, the folder will be marked complete (x prefix)</li>
            <li>Then return here to select the next folder</li>
        </ul>
    </div>
    
    <div class="folder-list">
"""
        
        if not folders:
            html_content += """
        <div class="no-folders">
            <h2>✅ All folders processed!</h2>
            <p style="margin-top: 10px;">No unprocessed folders found.</p>
        </div>
"""
        else:
            for folder in folders:
                cr2_count = len(list(folder.glob("*.CR2")))
                html_content += f"""
        <button class="folder-button" onclick="selectFolder('{folder.name}')">
            <div class="folder-name">📁 {folder.name}</div>
            <div class="folder-info">{cr2_count} images</div>
        </button>
"""
        
        html_content += """
    </div>
    
    <script>
        function selectFolder(folderName) {
            // Redirect to specific folder processor page
            window.location.href = 'process_' + folderName + '.html';
        }
    </script>
</body>
</html>
"""
        
        with open(html_path, 'w') as f:
            f.write(html_content)
        
        return html_path
    
    def create_html_viewer(self, result):
        """Create interactive HTML interface for single folder"""
        folder_name = result['folder']
        html_path = self.work_dir / f"process_{folder_name}.html"
        
        folder_name = result['folder']
        folder_path = result['folder_path']
        
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Process: {folder_name}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
        }}
        
        h1 {{ text-align: center; margin-bottom: 30px; color: #4a9eff; }}
        
        .folder-info {{
            text-align: center;
            font-size: 18px;
            color: #66d9ef;
            margin-bottom: 20px;
        }}
        
        .image-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-top: 20px;
            margin-bottom: 120px;
        }}
        
        .image-card {{
            background: #333;
            border-radius: 8px;
            padding: 15px;
            transition: all 0.2s;
        }}
        
        .image-card:hover {{
            transform: scale(1.02);
            box-shadow: 0 4px 20px rgba(74, 158, 255, 0.3);
        }}
        
        .image-card.selected {{
            border: 3px solid #4a9eff;
            background: #3a3a3a;
        }}
        
        .image-card.processed {{
            opacity: 0.3;
            pointer-events: none;
        }}
        
        .image-card img {{
            width: 100%;
            height: auto;
            border-radius: 5px;
            cursor: pointer;
        }}
        
        .image-label {{
            text-align: center;
            margin-top: 10px;
            font-size: 14px;
            color: #a0a0a0;
        }}
        
        .image-filename {{
            font-family: 'Courier New', monospace;
            color: #f92672;
            font-weight: bold;
        }}
        
        .checkbox-container {{
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 10px;
            gap: 8px;
        }}
        
        .checkbox-container input[type="checkbox"] {{
            width: 20px;
            height: 20px;
            cursor: pointer;
        }}
        
        .checkbox-container label {{
            cursor: pointer;
            font-weight: bold;
            color: #4a9eff;
        }}
        
        .button-container {{
            position: fixed;
            bottom: 30px;
            right: 30px;
            z-index: 100;
            display: flex;
            gap: 15px;
            flex-direction: column;
        }}
        
        .action-button {{
            background: #4a9eff;
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 16px;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(74, 158, 255, 0.4);
            transition: all 0.2s;
            position: relative;
        }}
        
        .action-button:hover {{
            background: #66b3ff;
            transform: translateY(-2px);
        }}
        
        .action-button:disabled {{
            background: #555;
            cursor: not-allowed;
            box-shadow: none;
        }}
        
        .complete-button {{
            background: #66d966;
        }}
        
        .complete-button:hover {{
            background: #7fef7f;
        }}
        
        .selection-count {{
            background: #f92672;
            color: white;
            border-radius: 50%;
            padding: 5px 10px;
            font-size: 14px;
            position: absolute;
            top: -10px;
            right: -10px;
            min-width: 25px;
            text-align: center;
        }}
        
        .instructions {{
            background: #2a4a2a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            border-left: 4px solid #4a9eff;
        }}
        
        .instructions h2 {{ margin-bottom: 10px; color: #66d9ef; }}
        .instructions ul {{ margin-left: 20px; }}
        .instructions li {{ margin: 5px 0; }}
        
        .lightbox {{
            display: none;
            position: fixed;
            z-index: 999;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            justify-content: center;
            align-items: center;
        }}
        
        .lightbox.active {{ display: flex; }}
        
        .lightbox img {{
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
        }}
        
        .lightbox-close {{
            position: absolute;
            top: 20px;
            right: 40px;
            font-size: 40px;
            color: white;
            cursor: pointer;
            font-weight: bold;
        }}
    </style>
</head>
<body>
    <h1>🖼️ Process Background Images</h1>
    <div class="folder-info">📁 {folder_name}</div>
    
    <div class="instructions">
        <h2>Instructions:</h2>
        <ul>
            <li>Click any image to view full-size</li>
            <li><strong>Select 1 image:</strong> Saves it for processing</li>
            <li><strong>Select 2+ images:</strong> Stacks them together</li>
            <li>Click "Process Selection" - processed images will fade</li>
            <li>When done with all images, click "Mark Folder Complete"</li>
        </ul>
    </div>
    
    <div class="image-grid">
"""
        
        for idx, img in enumerate(result['images']):
            rel_path = f"background_previews/{img['preview']}"
            card_id = f"card_{idx}"
            html_content += f"""
        <div class="image-card" id="{card_id}">
            <img src="{rel_path}" alt="{img['original']}" onclick="openLightbox(this.src)">
            <div class="image-label">
                <span class="image-filename">{img['original']}</span>
            </div>
            <div class="checkbox-container">
                <input type="checkbox" 
                       id="check_{idx}" 
                       data-original="{img['original']}"
                       data-preview="{img['preview']}"
                       data-source-path="{img['source_path']}"
                       onchange="toggleSelection(this)">
                <label for="check_{idx}">Select this image</label>
            </div>
        </div>
"""
        
        html_content += f"""
    </div>
    
    <div class="button-container">
        <button class="action-button" id="processButton" onclick="processSelection()" disabled>
            ⚡ Process Selection
            <span class="selection-count" id="selectionCount">0</span>
        </button>
        <button class="action-button complete-button" onclick="markComplete()">
            ✅ Mark Folder Complete
        </button>
    </div>
    
    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close">&times;</span>
        <img id="lightbox-img" src="" alt="Full size image">
    </div>
    
    <script>
        let selectedImages = [];
        const folderName = '{folder_name}';
        const folderPath = '{folder_path}';
        
        function toggleSelection(checkbox) {{
            const cardId = 'card_' + checkbox.id.replace('check_', '');
            const card = document.getElementById(cardId);
            
            if (checkbox.checked) {{
                card.classList.add('selected');
                selectedImages.push({{
                    original: checkbox.dataset.original,
                    preview: checkbox.dataset.preview,
                    source_path: checkbox.dataset.sourcePath,
                    card_id: cardId
                }});
            }} else {{
                card.classList.remove('selected');
                selectedImages = selectedImages.filter(
                    img => img.source_path !== checkbox.dataset.sourcePath
                );
            }}
            
            updateUI();
        }}
        
        function updateUI() {{
            const count = selectedImages.length;
            document.getElementById('selectionCount').textContent = count;
            document.getElementById('processButton').disabled = count === 0;
            
            const button = document.getElementById('processButton');
            if (count === 1) {{
                button.innerHTML = '💾 Save Selected Image<span class="selection-count">' + count + '</span>';
            }} else if (count > 1) {{
                button.innerHTML = '📚 Stack & Save ' + count + ' Images<span class="selection-count">' + count + '</span>';
            }} else {{
                button.innerHTML = '⚡ Process Selection<span class="selection-count">0</span>';
            }}
        }}
        
        function processSelection() {{
            if (selectedImages.length === 0) return;
            
            const action = selectedImages.length === 1 ? 'select' : 'stack';
            const data = {{
                action: action,
                folder: folderName,
                folder_path: folderPath,
                images: selectedImages
            }};
            
            // Save request
            const dataStr = JSON.stringify(data, null, 2);
            const blob = new Blob([dataStr], {{ type: 'application/json' }});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'process_request.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Mark processed cards
            selectedImages.forEach(img => {{
                const card = document.getElementById(img.card_id);
                if (card) {{
                    card.classList.add('processed');
                    const checkbox = card.querySelector('input[type="checkbox"]');
                    if (checkbox) checkbox.checked = false;
                }}
            }});
            
            // Clear selection
            selectedImages = [];
            updateUI();
            
            alert('Selection saved to process_request.json in Downloads!');
        }}
        
        function markComplete() {{
            if (confirm('Mark folder "' + folderName + '" as complete?\\n\\nThis will add "x" prefix and return to folder selection.')) {{
                // Save completion request
                const data = {{
                    action: 'complete',
                    folder: folderName,
                    folder_path: folderPath
                }};
                
                const dataStr = JSON.stringify(data, null, 2);
                const blob = new Blob([dataStr], {{ type: 'application/json' }});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'complete_folder.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert('Folder marked complete! Returning to folder selection...');
                window.location.href = 'select_folder.html';
            }}
        }}
        
        function openLightbox(src) {{
            document.getElementById('lightbox').classList.add('active');
            document.getElementById('lightbox-img').src = src;
        }}
        
        function closeLightbox() {{
            document.getElementById('lightbox').classList.remove('active');
        }}
        
        document.addEventListener('keydown', function(e) {{
            if (e.key === 'Escape') closeLightbox();
        }});
        
        updateUI();
    </script>
</body>
</html>
"""
        
        with open(html_path, 'w') as f:
            f.write(html_content)
        
        return html_path
    
    def run(self):
        """Main workflow"""
        print("Ask-Marvin Background Processor UI")
        print("="*60)
        
        unprocessed = self.find_unprocessed_folders()
        
        if not unprocessed:
            print("No unprocessed folders found!")
            print("Creating folder selection page...")
            html_path = self.create_folder_selection_page([], {})
            os.system(f'open "{html_path}"')
            return
        
        print(f"\nFound {len(unprocessed)} unprocessed folder(s):")
        for folder in unprocessed:
            print(f"  - {folder.name}")
        
        # Create folder selection page
        print("\nCreating folder selection page...")
        
        # Pre-process all folders and create their processor pages
        print("\nPre-processing images for all folders...")
        folder_results = {}
        for folder in unprocessed:
            result = self.process_folder(folder)
            if result:
                # Create processor page for this folder
                self.create_html_viewer(result)
                folder_results[folder.name] = result
        
        select_path = self.create_folder_selection_page(unprocessed, folder_results)
        
        print(f"\n{'='*60}")
        print("✅ Ready!")
        print(f"{'='*60}")
        print(f"\nWorkflow:")
        print(f"  1. Select a folder to process")
        print(f"  2. Select/stack images in that folder")
        print(f"  3. Mark folder complete when done")
        print(f"  4. Folder gets 'x' prefix")
        print(f"  5. Select next folder")
        
        os.system(f'open "{select_path}"')
        
        return unprocessed


if __name__ == "__main__":
    work_dir = "/Users/bcottraven/CyanoVerse/Image_Processing"
    processor = BackgroundProcessorUI(work_dir)
    processor.run()
