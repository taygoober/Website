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

// Generate random sleep time between requests
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = async (min = 1000, max = 3000) => {
  const sleepTime = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(sleepTime);
};

// User agent rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
];

const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

async function downloadImage(url, filepath, retries = 3) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    });
    
    // Use sharp to optimize and resize the image
    await sharp(response.data)
      .resize(800)  // Resize to max width of 800px
      .webp({ quality: 85 })  // Convert to WebP with 85% quality
      .toFile(filepath);
      
    return filepath;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying download after error: ${error.message}`);
      await randomSleep(2000, 5000);
      return downloadImage(url, filepath, retries - 1);
    }
    console.error(`Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

// Fallback method - Use sample data when scraping fails
function generateSampleData() {
  console.log("Using fallback sample data...");
  
  const samplePosts = [];
  
  // Create sample post data
  for (let i = 1; i <= NUM_POSTS; i++) {
    const sampleId = `sample-${i}-${Date.now()}`;
    samplePosts.push({
      id: sampleId,
      caption: `Sample Instagram Post ${i}`,
      imageUrl: `https://picsum.photos/seed/${sampleId}/800/800`,  // Random image from Lorem Picsum
      permalink: `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
      timestamp: new Date().toISOString()
    });
  }
  
  return samplePosts;
}

async function scrapeInstagramPosts() {
  try {
    console.log("Fetching Instagram posts...");
    
    // First try - direct approach with browser-like headers
    try {
      // Wait random time before request
      await randomSleep(1000, 2000);
      
      // Fetch Instagram profile page with appropriate headers
      const response = await axios.get(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
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
          console.log(`Found ${mediaItems.length} posts via old JSON format`);
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
              console.log(`Found ${mediaItems.length} posts via new JSON format`);
            }
          }
        } catch (e) {
          console.error("Error parsing newer JSON format:", e.message);
        }
      }
      
      if (mediaItems && mediaItems.length > 0) {
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
        
        if (processedPosts.length > 0) {
          await downloadAndUpdatePosts(processedPosts);
          return;
        }
      }
      
      // If we got here, try HTML parsing
      console.log("JSON data extraction failed, trying HTML parsing...");
      const $ = cheerio.load(html);
      
      // Look for image URLs in the HTML
      const htmlProcessedPosts = [];
      
      // Try to extract post data from any <img> tags that might be from posts
      $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        const alt = $(elem).attr('alt') || '';
        
        // Only process if we haven't reached our limit yet
        if (htmlProcessedPosts.length < NUM_POSTS && src && src.includes('instagram')) {
          const randomId = Date.now() + Math.floor(Math.random() * 1000);
          
          htmlProcessedPosts.push({
            id: randomId,
            caption: alt,
            imageUrl: src,
            permalink: `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      if (htmlProcessedPosts.length > 0) {
        console.log(`Found ${htmlProcessedPosts.length} posts via HTML parsing`);
        await downloadAndUpdatePosts(htmlProcessedPosts);
        return;
      }
    } catch (e) {
      console.error("Direct scraping attempt failed:", e.message);
    }
    
    // If all scraping attempts failed, use sample data
    const samplePosts = generateSampleData();
    await downloadAndUpdatePosts(samplePosts);
    
  } catch (error) {
    console.error("Error scraping Instagram posts:", error.message);
    console.error("Stack trace:", error.stack);
    
    // Final fallback - use simple generated content
    try {
      const emergencyPosts = generateSampleData();
      await downloadAndUpdatePosts(emergencyPosts);
    } catch (lastError) {
      console.error("Emergency fallback failed:", lastError.message);
      process.exit(1);
    }
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
      // If URL is from picsum (sample data), download directly
      if (imgUrl.includes('picsum.photos')) {
        await downloadImage(imgUrl, localPath);
        
        // Use the local path for the HTML
        processedPosts.push({
          id: postId,
          caption: post.caption || '',
          imageUrl: localPath,
          permalink: post.permalink,
          timestamp: post.timestamp
        });
      } else {
        // For Instagram images, wait between downloads
        await randomSleep(1500, 3000);
        
        // Download and optimize the image
        await downloadImage(imgUrl, localPath);
        
        processedPosts.push({
          id: postId,
          caption: post.caption || '',
          imageUrl: localPath,
          permalink: post.permalink,
          timestamp: post.timestamp
        });
      }
      
      console.log(`Successfully processed: ${filename}`);
    } catch (error) {
      console.error(`Error processing image: ${error.message}`);
      
      // Create a fallback image if download fails
      try {
        // Use Lorem Picsum as fallback
        const fallbackUrl = `https://picsum.photos/seed/${postId}/800/800`;
        await downloadImage(fallbackUrl, localPath);
        
        processedPosts.push({
          id: postId,
          caption: post.caption || 'Instagram Post',
          imageUrl: localPath,
          permalink: post.permalink || `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
          timestamp: post.timestamp || new Date().toISOString()
        });
        
        console.log(`Used fallback image for: ${filename}`);
      } catch (fbError) {
        console.error(`Fallback image generation failed: ${fbError.message}`);
      }
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
        `<!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n            <!-- INSTAGRAM POSTS END -->`
      );
    } else {
      // Add new Instagram posts to the gallery
      html = html.replace(
        /<div class="gallery">/,
        `<div class="gallery">\n            <!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n            <!-- INSTAGRAM POSTS END -->`
      );
    }
    
    // Write the updated HTML
    fs.writeFileSync(HTML_FILE, html);
    console.log('HTML updated with Instagram posts');
    
  } catch (error) {
    console.error("Error updating HTML:", error.message);
  }
}

// Run the scraper
scrapeInstagramPosts();const axios = require('axios');
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

// Generate random sleep time between requests
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = async (min = 1000, max = 3000) => {
  const sleepTime = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(sleepTime);
};

// User agent rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
];

const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

async function downloadImage(url, filepath, retries = 3) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    });
    
    // Use sharp to optimize and resize the image
    await sharp(response.data)
      .resize(800)  // Resize to max width of 800px
      .webp({ quality: 85 })  // Convert to WebP with 85% quality
      .toFile(filepath);
      
    return filepath;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying download after error: ${error.message}`);
      await randomSleep(2000, 5000);
      return downloadImage(url, filepath, retries - 1);
    }
    console.error(`Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

// Fallback method - Use sample data when scraping fails
function generateSampleData() {
  console.log("Using fallback sample data...");
  
  const samplePosts = [];
  
  // Create sample post data
  for (let i = 1; i <= NUM_POSTS; i++) {
    const sampleId = `sample-${i}-${Date.now()}`;
    samplePosts.push({
      id: sampleId,
      caption: `Sample Instagram Post ${i}`,
      imageUrl: `https://picsum.photos/seed/${sampleId}/800/800`,  // Random image from Lorem Picsum
      permalink: `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
      timestamp: new Date().toISOString()
    });
  }
  
  return samplePosts;
}

async function scrapeInstagramPosts() {
  try {
    console.log("Fetching Instagram posts...");
    
    // First try - direct approach with browser-like headers
    try {
      // Wait random time before request
      await randomSleep(1000, 2000);
      
      // Fetch Instagram profile page with appropriate headers
      const response = await axios.get(`https://www.instagram.com/${INSTAGRAM_USERNAME}/`, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
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
          console.log(`Found ${mediaItems.length} posts via old JSON format`);
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
              console.log(`Found ${mediaItems.length} posts via new JSON format`);
            }
          }
        } catch (e) {
          console.error("Error parsing newer JSON format:", e.message);
        }
      }
      
      if (mediaItems && mediaItems.length > 0) {
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
        
        if (processedPosts.length > 0) {
          await downloadAndUpdatePosts(processedPosts);
          return;
        }
      }
      
      // If we got here, try HTML parsing
      console.log("JSON data extraction failed, trying HTML parsing...");
      const $ = cheerio.load(html);
      
      // Look for image URLs in the HTML
      const htmlProcessedPosts = [];
      
      // Try to extract post data from any <img> tags that might be from posts
      $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        const alt = $(elem).attr('alt') || '';
        
        // Only process if we haven't reached our limit yet
        if (htmlProcessedPosts.length < NUM_POSTS && src && src.includes('instagram')) {
          const randomId = Date.now() + Math.floor(Math.random() * 1000);
          
          htmlProcessedPosts.push({
            id: randomId,
            caption: alt,
            imageUrl: src,
            permalink: `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      if (htmlProcessedPosts.length > 0) {
        console.log(`Found ${htmlProcessedPosts.length} posts via HTML parsing`);
        await downloadAndUpdatePosts(htmlProcessedPosts);
        return;
      }
    } catch (e) {
      console.error("Direct scraping attempt failed:", e.message);
    }
    
    // If all scraping attempts failed, use sample data
    const samplePosts = generateSampleData();
    await downloadAndUpdatePosts(samplePosts);
    
  } catch (error) {
    console.error("Error scraping Instagram posts:", error.message);
    console.error("Stack trace:", error.stack);
    
    // Final fallback - use simple generated content
    try {
      const emergencyPosts = generateSampleData();
      await downloadAndUpdatePosts(emergencyPosts);
    } catch (lastError) {
      console.error("Emergency fallback failed:", lastError.message);
      process.exit(1);
    }
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
      // If URL is from picsum (sample data), download directly
      if (imgUrl.includes('picsum.photos')) {
        await downloadImage(imgUrl, localPath);
        
        // Use the local path for the HTML
        processedPosts.push({
          id: postId,
          caption: post.caption || '',
          imageUrl: localPath,
          permalink: post.permalink,
          timestamp: post.timestamp
        });
      } else {
        // For Instagram images, wait between downloads
        await randomSleep(1500, 3000);
        
        // Download and optimize the image
        await downloadImage(imgUrl, localPath);
        
        processedPosts.push({
          id: postId,
          caption: post.caption || '',
          imageUrl: localPath,
          permalink: post.permalink,
          timestamp: post.timestamp
        });
      }
      
      console.log(`Successfully processed: ${filename}`);
    } catch (error) {
      console.error(`Error processing image: ${error.message}`);
      
      // Create a fallback image if download fails
      try {
        // Use Lorem Picsum as fallback
        const fallbackUrl = `https://picsum.photos/seed/${postId}/800/800`;
        await downloadImage(fallbackUrl, localPath);
        
        processedPosts.push({
          id: postId,
          caption: post.caption || 'Instagram Post',
          imageUrl: localPath,
          permalink: post.permalink || `https://www.instagram.com/${INSTAGRAM_USERNAME}/`,
          timestamp: post.timestamp || new Date().toISOString()
        });
        
        console.log(`Used fallback image for: ${filename}`);
      } catch (fbError) {
        console.error(`Fallback image generation failed: ${fbError.message}`);
      }
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
        `<!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n            <!-- INSTAGRAM POSTS END -->`
      );
    } else {
      // Add new Instagram posts to the gallery
      html = html.replace(
        /<div class="gallery">/,
        `<div class="gallery">\n            <!-- INSTAGRAM POSTS START -->\n${instagramHtml}\n            <!-- INSTAGRAM POSTS END -->`
      );
    }
    
    // Write the updated HTML
    fs.writeFileSync(HTML_FILE, html);
    console.log('HTML updated with Instagram posts');
    
  } catch (error) {
    console.error("Error updating HTML:", error.message);
  }
}

// Run the scraper
scrapeInstagramPosts();
