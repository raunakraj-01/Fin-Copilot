import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

async function main() {
  console.log('Testing Gemini API key...');
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: 'Say: Gemini is connected and ready!',
    });
    console.log('SUCCESS! Response from Gemini:');
    console.log(response.text?.trim());
  } catch (err) {
    console.error('Gemini API call failed:', err.message);
  }
}

main();
