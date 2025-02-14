const express = require('express');
const crypto = require('crypto');
const shortid = require('shortid');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const QR_CODE_DIR = path.join(__dirname, 'public', 'qr-codes');

const CONFIG = {
    PUBLIC_DOMAIN: process.env.PUBLIC_DOMAIN || 'http://localhost:3000',
    PORT: process.env.PORT || 3000
};

async function ensureDirectoryExists(directory) {
    return new Promise((resolve, reject) => {
        fs.mkdir(directory, { recursive: true }, (err) => {
            if (err) {
                console.error('Error creating directory:', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

const urlDatabase = new Map();

class UrlEntry {
    constructor(originalUrl, shortUrl, customSlug = null, expiresAt = null) {
        this.originalUrl = originalUrl;
        this.shortUrl = shortUrl;
        this.customSlug = customSlug;
        this.createdAt = new Date();
        this.expiresAt = expiresAt;
        this.clicks = 0;
        this.qrCodePath = null;
    }
}

function generateShortUrl(customSlug) {
    return customSlug || shortid.generate();
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

async function generateQRCode(originalUrl, shortUrl) {
    await ensureDirectoryExists(QR_CODE_DIR);
    
    const qrCodeFileName = `${shortUrl}-qr.png`;
    const qrCodePath = path.join(QR_CODE_DIR, qrCodeFileName);
    
    try {
        await QRCode.toFile(qrCodePath, originalUrl, {
            color: {
                dark: '#00DC82',
                light: '#FFFFFF'
            },
            margin: 2,
            width: 300
        });
        
        return `/qr-codes/${qrCodeFileName}`;
    } catch (error) {
        console.error('QR Code generation error:', error);
        return null;
    }
}

function logNetworkInfo() {
    const networkInterfaces = os.networkInterfaces();
    console.log('Available Network Interfaces:');
    Object.keys(networkInterfaces).forEach((interfaceName) => {
        networkInterfaces[interfaceName].forEach((details) => {
            if (details.family === 'IPv4' && !details.internal) {
                console.log(`- Interface: ${interfaceName}`);
                console.log(`  IP Address: ${details.address}`);
            }
        });
    });
    console.log('\nPublic Domain Configuration:');
    console.log(`Current Public Domain: ${CONFIG.PUBLIC_DOMAIN}`);
    console.log('Tip: Set PUBLIC_DOMAIN environment variable for external access');
}

app.post('/shorten', async (req, res) => {
    const { url: originalUrl, customSlug, expiry } = req.body;

    if (!isValidUrl(originalUrl)) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (customSlug && Array.from(urlDatabase.values()).some(entry => 
        entry.customSlug === customSlug || entry.shortUrl === customSlug)) {
        return res.status(400).json({ error: 'Custom slug already in use' });
    }

    const shortUrl = generateShortUrl(customSlug);
    const expiresAt = expiry > 0 
        ? new Date(Date.now() + expiry * 24 * 60 * 60 * 1000) 
        : null;

    const urlEntry = new UrlEntry(originalUrl, shortUrl, customSlug, expiresAt);
    const fullShortUrl = `${CONFIG.PUBLIC_DOMAIN}/${shortUrl}`;

    try {
        const qrCodePath = await generateQRCode(originalUrl, shortUrl);
        
        if (qrCodePath) {
            urlEntry.qrCodePath = qrCodePath;
        }
        
        urlDatabase.set(shortUrl, urlEntry);
        
        res.json({
            shortURL: `${CONFIG.PUBLIC_DOMAIN}/${shortUrl}`,
            originalURL: originalUrl,
            qrCodePath: qrCodePath || "",
        });
    } catch (error) {
        console.error('URL shortening error:', error);
        res.status(500).json({ error: 'Failed to process URL' });
    }

});

app.get('/:shortUrl', (req, res) => {
    const urlEntry = urlDatabase.get(req.params.shortUrl);

    if (!urlEntry) {
        return res.status(404).send('URL not found');
    }

    if (urlEntry.expiresAt && urlEntry.expiresAt < new Date()) {
        urlDatabase.delete(req.params.shortUrl);
        return res.status(410).send('URL has expired');
    }

    urlEntry.clicks++;

    const fullShortUrl = `${CONFIG.PUBLIC_DOMAIN}/${req.params.shortUrl}`;

    const redirectHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Redirecting...</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh; 
                margin: 0; 
                background-color: #f0f0f0;
            }
            .redirect-container {
                text-align: center;
                padding: 20px;
                background-color: white;
                border-radius: 10px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                max-width: 90%;
                width: 400px;
            }
            .redirect-btn, .copy-btn {
                display: inline-block;
                padding: 10px 20px;
                background-color: #00DC82;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin: 10px 5px;
                cursor: pointer;
                border: none;
                font-size: 16px;
            }
            .copy-btn {
                background-color: #4A90E2;
            }
            .short-url {
                word-break: break-all;
                margin: 15px 0;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 5px;
                font-size: 14px;
            }
            .qr-container {
                margin: 15px 0;
            }
            .qr-container img {
                max-width: 200px;
                height: auto;
            }
            .success-message {
                color: #00DC82;
                margin-top: 5px;
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="redirect-container">
            <h2>You are being redirected</h2>
            <div class="short-url">
                ${fullShortUrl}
            </div>
            <div class="qr-container">
                <img src="${urlEntry.qrCodePath}" alt="QR Code" />
            </div>
            <button class="copy-btn" onclick="copyToClipboard()">Copy URL</button>
            <a href="${urlEntry.originalUrl}" class="redirect-btn">Go to Website</a>
            <div class="success-message" id="copySuccess">URL copied to clipboard!</div>
        </div>
        <script>
            function copyToClipboard() {
                const shortUrl = '${fullShortUrl}';
                navigator.clipboard.writeText(shortUrl).then(() => {
                    const msg = document.getElementById('copySuccess');
                    msg.style.display = 'block';
                    setTimeout(() => {
                        msg.style.display = 'none';
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                });
            }
            setTimeout(() => {
                window.location.href = "${urlEntry.originalUrl}";
            }, 3000);
        </script>
    </body>
    </html>
    `;

    res.send(redirectHtml);
});


app.get('/analytics/:shortUrl', (req, res) => {
    const urlEntry = urlDatabase.get(req.params.shortUrl);

    if (!urlEntry) {
        return res.status(404).json({ error: 'URL not found' });
    }

    res.json({
        clicks: urlEntry.clicks,
        createdAt: urlEntry.createdAt,
        expiresAt: urlEntry.expiresAt
    });
});

const server = app.listen(CONFIG.PORT, () => {
    console.log(`Server running on port ${CONFIG.PORT}`);
    logNetworkInfo();
    console.log('\nTo make this accessible from anywhere:');
    console.log('1. Use a domain name with proper DNS configuration');
    console.log('2. Or use a service like ngrok: ngrok http 3000');
    console.log('3. Update PUBLIC_DOMAIN accordingly');
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});