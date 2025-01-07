# TikTok Transcription API

Convert TikTok videos to text easily. No video downloads needed - just provide a TikTok URL and get back the transcription.

## 🚀 Quick Start

1. Install dependencies:
```bash
bun install
```

2. Create `.env` file:
```env
ASSEMBLYAI_API_KEY=your_api_key_here
```

3. Start the server:
```bash
bun dev
```

## 📝 API Usage

### Transcribe a TikTok Video

```javascript
// POST http://localhost:3000/transcribe
const response = await fetch('http://localhost:3000/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        url: "https://www.tiktok.com/@username/video/1234567890"
    })
});

const data = await response.json();
// data = {
//     success: true,
//     transcription: "The transcribed text",
//     cached: false
// }
```

### Check API Health

```javascript
// GET http://localhost:3000/health
const response = await fetch('http://localhost:3000/health');
const data = await response.json();
// data = { status: "ok" }
```

## ⚡ Features

- Fast transcription using AssemblyAI
- Automatic caching of results
- No local video/audio downloads
- Simple REST API
- Built with Bun for performance

## 🔧 Error Handling

The API returns clear error messages:

```javascript
// Error Response
{
    "success": false,
    "error": "Error message here"
}
```

Common errors:
- Invalid TikTok URL
- Network issues
- Transcription failed

## 💻 Example Integration (Next.js)

```javascript
// utils/transcribe.js
export async function transcribeTikTok(tiktokUrl) {
    const response = await fetch('http://localhost:3000/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tiktokUrl })
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    return data.transcription;
}

// Usage in component
const [result, setResult] = useState('');
const [loading, setLoading] = useState(false);

async function handleTranscribe(url) {
    setLoading(true);
    try {
        const text = await transcribeTikTok(url);
        setResult(text);
    } catch (error) {
        console.error(error);
    }
    setLoading(false);
}
```

## 📋 Requirements

- [Bun](https://bun.sh/) installed
- [AssemblyAI API key](https://www.assemblyai.com/dashboard/signup)

## 🔍 Need Help?

1. Make sure your AssemblyAI API key is valid
2. Verify the TikTok URL is accessible
3. Check the server logs for detailed errors

## 🛠️ Development

```bash
# Clone the repo
git clone <repo-url>
cd tiktok-transcription-api

# Install dependencies
bun install

# Start development server
bun dev
```

The server will start at `http://localhost:3000`

## 📝 License

MIT
