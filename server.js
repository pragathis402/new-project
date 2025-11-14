import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env file
dotenv.config();

const app = express();
const port = 3000;

// --- Correct __dirname setup for ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from current directory
app.use(express.static(__dirname));

// Middleware to parse JSON request body
app.use(express.json());

// --- Helper: Extract JSON safely from AI response ---
function extractJSON(text) {
  const jsonMatch = text.match(/{[\s\S]*}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error("Failed to parse JSON from AI response.");
    }
  }
  throw new Error("No valid JSON object found in AI response.");
}

// --- Helper: Retry logic for Gemini API ---
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    if (response.status === 503) {
      console.warn(`⚠️ Model overloaded (attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`);
      await new Promise(res => setTimeout(res, delay));
    } else {
      const errorBody = await response.text();
      console.error("Google API Error:", errorBody);
      throw new Error(`Google API request failed with status ${response.status}`);
    }
  }
  throw new Error("Model overloaded after multiple retries.");
}

// --- /generate endpoint ---
app.post("/generate", async (req, res) => {
  try {
    const { topic } = req.body;
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) {
      throw new Error("GOOGLE_API_KEY is not defined in .env file.");
    }
    if (!topic) {
      return res.status(400).json({ error: "No topic provided in request." });
    }

    const MODELS = [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash-lite"
    ];

    const prompt = `
      You are an expert web developer. A user requested a webpage for topic: "${topic}".
      Generate a complete, modern, visually appealing single-page website.
      HTML, CSS, and JS must each exceed 50 lines.
      Respond ONLY with a single JSON object:
      {"html": "HTML code here", "css": "CSS code here", "js": "JS code here"}
      No extra explanations or markdown.
    `;

    let success = false;
    let finalResponse = null;

    for (const model of MODELS) {
      const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      console.log(`🔹 Trying model: ${model}`);

      try {
        const response = await fetchWithRetry(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          })
        });

        const data = await response.json();

        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
          throw new Error("Invalid response structure from Google API.");
        }

        const jsonString = data.candidates[0].content.parts[0].text;
        const code = extractJSON(jsonString);

        success = true;
        finalResponse = code;
        console.log(`✅ Success using model: ${model}`);
        break;

      } catch (error) {
        console.error(`❌ Error using ${model}:`, error.message);
      }
    }

    if (success && finalResponse) {
      res.json(finalResponse);
    } else {
      throw new Error("All Gemini models are currently overloaded or unavailable. Please try again later.");
    }

  } catch (error) {
    console.error("Error calling Gemini API:", error.message);
    res.status(503).json({
      error: error.message || "The AI service is currently overloaded or unavailable. Please try again later."
    });
  }
});

// ----------------------------------------------------
// 🔥 NEW FEATURE: AI ASSISTANT ENDPOINT (Q&A chatbot)
// ----------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) return res.status(500).json({ error: "Missing API key" });
    if (!message) return res.status(400).json({ error: "Message is required" });

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I am unable to answer right now.";

    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: "AI assistant failed. Try again later." });
  }
});

// --- Start the server ---
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
