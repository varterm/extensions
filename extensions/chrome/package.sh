#!/bin/bash
# Package Chrome extension for Web Store submission

cd "$(dirname "$0")"

# Create dist directory
rm -rf dist
mkdir -p dist

# Copy all required files
cp manifest.json dist/
cp background.js dist/
cp content.js dist/
cp youtube.js dist/
cp claude.js dist/
cp chats.js dist/
cp sites.js dist/
cp panel.js dist/
cp voices.js dist/
cp content.css dist/
cp popup.html dist/
cp popup.js dist/
cp -r icons dist/

# Create zip
cd dist
zip -r ../varterm-tts-chrome.zip .
cd ..

echo ""
echo "✅ Chrome extension packaged: varterm-tts-chrome.zip"
echo ""
echo "Next steps:"
echo "1. Go to https://chrome.google.com/webstore/devconsole"
echo "2. Open the existing Varterm listing"
echo "3. Upload varterm-tts-chrome.zip as a new package"
echo "4. Update listing copy from STORE_LISTING.md"
echo "5. Submit for review"
