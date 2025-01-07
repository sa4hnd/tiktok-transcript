import express from 'express';
import cors from 'cors';
import SnapTikClient from './index.js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config();

// Performance optimizations
const app = express();
const port = process.env.PORT || 3000;
const ASSEMBLY_API_URL = 'https://api.assemblyai.com/v2';

// In-memory cache with expiration
const cache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting
const RATE_LIMIT = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30; // 30 requests per minute

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting middleware
function rateLimiter(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    
    if (RATE_LIMIT.has(ip)) {
        const requests = RATE_LIMIT.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
        if (requests.length >= MAX_REQUESTS) {
            return res.status(429).json({ 
                success: false, 
                error: 'Too many requests. Please try again later.' 
            });
        }
        requests.push(now);
        RATE_LIMIT.set(ip, requests);
    } else {
        RATE_LIMIT.set(ip, [now]);
    }
    
    next();
}

async function getTranscription(tiktokUrl) {
    try {
        // Check cache first
        if (cache.has(tiktokUrl)) {
            const { transcription, timestamp } = cache.get(tiktokUrl);
            if (Date.now() - timestamp < CACHE_DURATION) {
                return transcription;
            }
            cache.delete(tiktokUrl); // Clear expired cache
        }

        const client = new SnapTikClient();
        const result = await client.process(tiktokUrl);
        
        if (!result.type === 'video' || !result.data.sources || !result.data.sources.length) {
            throw new Error('No video source found');
        }

        const audioUrl = result.data.sources[0].url;

        // Optimized AssemblyAI settings
        const transcribeResponse = await fetch(`${ASSEMBLY_API_URL}/transcript`, {
            method: 'POST',
            headers: {
                'authorization': process.env.ASSEMBLYAI_API_KEY,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ 
                audio_url: audioUrl,
                speed_boost: true,
                language_detection: true,
                auto_highlights: false,
                auto_chapters: false,
                entity_detection: false,
                sentiment_analysis: false
            })
        });
        
        const { id: transcriptId, error } = await transcribeResponse.json();
        if (error) throw new Error(`Failed to start transcription: ${error}`);

        // Optimized polling with exponential backoff
        let attempts = 0;
        const maxAttempts = 15;
        let waitTime = 1000; // Start with 1 second

        while (attempts < maxAttempts) {
            const response = await fetch(`${ASSEMBLY_API_URL}/transcript/${transcriptId}`, {
                headers: {
                    'authorization': process.env.ASSEMBLYAI_API_KEY,
                },
            });
            const result = await response.json();

            if (result.status === 'completed') {
                // Store in cache
                cache.set(tiktokUrl, {
                    transcription: result.text,
                    timestamp: Date.now()
                });
                return result.text;
            } else if (result.status === 'error') {
                throw new Error(`Transcription failed: ${result.error}`);
            }
            
            attempts++;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            waitTime = Math.min(waitTime * 1.5, 5000); // Exponential backoff, max 5 seconds
        }

        throw new Error('Transcription timed out');
    } catch (error) {
        throw error;
    }
}

// Clean up expired cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, { timestamp }] of cache.entries()) {
        if (now - timestamp > CACHE_DURATION) {
            cache.delete(key);
        }
    }
}, 60 * 60 * 1000); // Clean up every hour

app.post('/transcribe', rateLimiter, async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing TikTok URL in request body' 
            });
        }

        const transcription = await getTranscription(url);
        
        res.json({ 
            success: true,
            transcription,
            cached: cache.has(url)
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
}); 