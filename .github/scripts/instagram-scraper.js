const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cheerio = require('cheerio');

// Configuration
const INSTAGRAM_USERNAME = 'taygoober'; // Your Instagram username
const NUM_POSTS = 3; // Number of posts to fetch
const PHOTO_DIR = 'instagram-photos';
const JSON_FILE = 'instagram-posts.json';
const HTML_FILE = 'index.html';

// Create photo directory if it doesn't exist
if (!fs.existsSync(PHOTO_DIR)) {
  fs.mkdirSync(PHOTO_DIR);
}

async function downloadImage(url, filepath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Use sharp to optimize and resize the image
    await sharp(response.data)
      .resize(800)  // Resize to max width of 800px
      .webp({ quality: 85 })  // Convert to WebP with 85% quality
      .toFile(filepath);
      
    return filepath;
  } catch (error) {
    console.error(`Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

async function scrapeInstagramPosts() {
  try {
    console.log("Fetching Instagram posts...");
    
    // Fetch Instagram profile page with appropriate headers
    const response = await axios.get(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    const html = response.data;
    
    // Try to find the JSON data in the page
    const jsonDataMatch = html.match(/<script type="text\/javascript">window\._sharedData = (.*?);<\/script>/);
    const jsonDataMatch2 = html.match(/<script type="application\/json" data-sjs>(.*?)<\/script>/);
    
    let mediaItems = [];
    
    if (jsonDataMatch && jsonDataMatch.length >= 2) {
      // Parse the JSON data from the old format
      const jsonData = JSON.parse(jsonDataMatch[1]);
      
      if (jsonData.entry_data && 
          jsonData.entry_data.ProfilePage && 
          jsonData.entry_data.ProfilePage[0] &&
          jsonData.entry_data.ProfilePage[0].graphql &&
          jsonData.entry_data.ProfilePage[0].graphql.user &&
          jsonData.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media &&
          jsonData.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media.edges) {
        
        mediaItems = jsonData.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media.edges;
      }
    } else if (jsonDataMatch2 && jsonDataMatch2.length >= 2) {
      // Try to parse the JSON data from the newer format
      try {
        const jsonData = JSON.parse(jsonDataMatch2[1]);
        
        // Find media items in the new structure (might need adjustment based on actual structure)
        if (jsonData.require && 
            Array.isArray(jsonData.require) && 
            jsonData.require.length > 0) {
          
          // Find the entry containing the user's posts
          const userData = jsonData.require.find(entry => 
            entry && 
            Array.isArray(entry) && 
            entry.length > 2 && 
            typeof entry[2] === 'object' && 
            entry[2].user && 
            entry[2].user.edge_owner_to_timeline_media
          );
          
          if (userData && userData[2].user && userData[2].user.edge_owner_to_timeline_media) {
            mediaItems = userData[2].user.edge_owner_to_timeline_media.edges;
          }
        }
      } catch (e) {
        console.error("Error parsing newer JSON format:", e.message);
      }
    }
    
    if (!mediaItems || mediaItems.length === 0) {
      // Fallback to HTML parsing if JSON extraction failed
      console.log("JSON data extraction failed, falling back to HTML parsing...");
      const $ = cheerio.load(html);
      
      // Look for image URLs in the HTML
      // This is a very basic approach and might break as Instagram changes its structure
      const processedPosts = [];
      
      // Try to extract post data from any <img> tags that might be from posts
      $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        const alt = $(elem).attr('alt') || '';
        
        // Only process if we haven't reached our limit yet
        if (processedPosts.length < NUM_POSTS && src && src.includes('instagram')) {
          const randomId = Date.now() + Math.floor(Math.random() * 1000);
          
          processedPosts.push({
            id: randomId,
            caption: alt,
            imageUrl: src,
            permalink: `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      if (processedPosts.length > 0) {
        console.log(`Found ${processedPosts.length} posts via HTML parsing`);
        downloadAndUpdatePosts(processedPosts);
        return;
      }
      
      throw new Error("Could not extract Instagram posts data");
    }
    
    console.log(`Found ${mediaItems.length} posts via JSON data`);
    
    // Process posts (only images, not videos)
    const processedPosts = [];
    let processedCount = 0;
    
    for (let i = 0; i < mediaItems.length && processedCount < NUM_POSTS; i++) {
      const node = mediaItems[i].node;
      
      // Skip videos if needed
      if (node.is_video && !node.thumbnail_src) {
        continue;
      }
      
      const imgUrl = node.display_url || node.thumbnail_src;
      const postId = node.id;
      const shortcode = node.shortcode;
      const caption = node.edge_media_to_caption?.edges[0]?.node?.text || '';
      
      processedPosts.push({
        id: postId,
        caption: caption,
        imageUrl: imgUrl,
        permalink: `https://www.instagram.com/p/${shortcode}/`,
        timestamp: new Date((node.taken_at_timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString()
      });
      
      processedCount++;
    }
    
    if (processedPosts.length === 0) {
      throw new Error("No suitable posts found");
    }
    
    await downloadAndUpdatePosts(processedPosts);
    
  } catch (error) {
    console.error("Error scraping Instagram posts:", error.message);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  }
}

async function downloadAndUpdatePosts(posts) {
  const processedPosts = [];
  
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const postId = post.id;
    const imgUrl = post.imageUrl;
    const filename = `instagram-${postId}.webp`;
    const localPath = path.join(PHOTO_DIR, filename);
    
    console.log(`Processing post ${i + 1}/${posts.length}`);
    
    try {
      // Download and optimize the image
      await downloadImage(imgUrl, localPath);
      
      processedPosts.push({
        id: postId,
        caption: post.caption || '',
        imageUrl: localPath,
        permalink: post.permalink,
        timestamp: post.timestamp
      });
      
      console.log(`Successfully processed: ${filename}`);
    } catch (error) {
      console.error(`Error processing image: ${error.message}`);
    }
  }
  
  // Save posts data to JSON file
  fs.writeFileSync(JSON_FILE, JSON.stringify(processedPosts, null, 2));
  console.log(`Instagram data saved to ${JSON_FILE}`);
  
  // Update the HTML file
  updateHtmlWithInstagramPosts(processedPosts);
}

function updateHtmlWithInstagramPosts(posts) {
  try {
    // Read the HTML file
    let html = fs.readFileSync(HTML_FILE, 'utf8');
    
    // Create HTML for Instagram posts with Instagram class
    const instagramHtml = posts.map(post => {
      const caption = post.caption 
        ? post.caption.substring(0, 50) + (post.caption.length > 50 ? '...' : '') 
        : 'View on Instagram';
      
      return `
            <!-- Instagram photo item -->
            <div class="photo instagram-post" onclick="window.open('${post.permalink}', '_blank')">
              <img src="${post.imageUrl}" alt="Instagram Post">
              <div class="photo-overlay">
                <h3>Instagram</h3>
                <p>${caption}</p>
              </div>
            </div>`;
    }).join('\n');
    
    // Find if there's already an Instagram section
    if (html.includes('<!-- INSTAGRAM POSTS START -->')) {
      // Replace existing Instagram posts section
      html = html.replace(
        /<!-- INSTAGRAM POSTS START -->[\s\S]*?<!-- INSTAGRAM POSTS END -->/,
        `<!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n          <!-- INSTAGRAM POSTS END -->`
      );
    } else {
      // Add new Instagram posts to the gallery
      html = html.replace(
        /<div class="gallery">/,
        `<div class="gallery">\n          <!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n          <!-- INSTAGRAM POSTS END -->`
      );
    }
    
    // Write the updated HTML
    fs.writeFileSync(HTML_FILE, html);
    console.log('HTML updated with Instagram posts');
    
  } catch (error) {
    console.error("Error updating HTML:", error.message);
  }
}

// Run the script
scrapeInstagramPosts();
