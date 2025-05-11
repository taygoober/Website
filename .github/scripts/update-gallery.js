const fs = require('fs');
const path = require('path');

// Configuration
const PHOTOS_DIR = 'my-photos';
const HTML_FILE = 'index.html';
const MAX_PHOTOS = 3; // Number of photos to include

// Get the most recent files from the photos directory
function getLatestPhotos() {
  try {
    // Check if directory exists
    if (!fs.existsSync(PHOTOS_DIR)) {
      console.log(`Creating ${PHOTOS_DIR} directory`);
      fs.mkdirSync(PHOTOS_DIR);
      return [];
    }
    
    // Get all files in the directory
    const files = fs.readdirSync(PHOTOS_DIR)
      .filter(file => {
        // Only include image files
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
      })
      .map(file => {
        const filePath = path.join(PHOTOS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          file: file,
          path: filePath,
          mtime: stats.mtime.getTime()
        };
      });
    
    // Sort by modification time (newest first)
    files.sort((a, b) => b.mtime - a.mtime);
    
    // Take the most recent files
    return files.slice(0, MAX_PHOTOS);
  } catch (error) {
    console.error(`Error getting photos: ${error.message}`);
    return [];
  }
}

// Update this part of the function
function updateHtml(photos) {
  try {
    // Read the HTML file
    let html = fs.readFileSync(HTML_FILE, 'utf8');
    
    // Create HTML for photo gallery
    const photosHtml = photos.map(photo => {
      const filename = photo.file;
      const prettyName = filename.replace(/\.[^/.]+$/, "").replace(/-/g, " ");
      const displayName = prettyName.charAt(0).toUpperCase() + prettyName.slice(1);
      
      return `
    <!-- Photo item -->
    <div class="photo">
      <img src="${photo.path}" alt="${displayName}">
      <div class="photo-overlay">
        <h3>Photo</h3>
        <p>${displayName}</p>
      </div>
    </div>`;
    }).join('\n');
    
    // Find if there's already a BLUESKY PHOTOS section
    if (html.includes('<!-- BLUESKY PHOTOS START -->')) {
      // Replace existing section
      html = html.replace(
        /<!-- BLUESKY PHOTOS START -->[\s\S]*?<!-- BLUESKY PHOTOS END -->/,
        `<!-- BLUESKY PHOTOS START -->\n${photosHtml}\n    <!-- BLUESKY PHOTOS END -->`
      );
    } else {
      // Add new section after gallery div opening
      html = html.replace(
        /<div class="gallery">/,
        `<div class="gallery">\n    <!-- BLUESKY PHOTOS START -->\n${photosHtml}\n    <!-- BLUESKY PHOTOS END -->`
      );
    }
    
    // Write the updated HTML
    fs.writeFileSync(HTML_FILE, html);
    console.log('HTML updated with photos');
    
  } catch (error) {
    console.error(`Error updating HTML: ${error.message}`);
  }
}

// Main execution
const latestPhotos = getLatestPhotos();
console.log(`Found ${latestPhotos.length} photos to add to gallery`);

if (latestPhotos.length > 0) {
  updateHtml(latestPhotos);
} else {
  console.log('No photos found to add to gallery');
}
