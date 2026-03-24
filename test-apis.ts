import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

async function main() {
  const google = createGoogleGenerativeAI({
    apiKey: 'AIzaSyCVABT22H2MjA3okTjaxPfFb05EB2nBQAI'
  });

  const models = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite-preview-02-05',
    'gemini-3.1-flash-lite-preview'
  ];

  for (const m of models) {
     console.log(`\n--- Testing ${m} ---`);
     try {
       const model = google(m);
       const { text } = await generateText({
         model,
         prompt: 'Hello!'
       });
       console.log(`Works for ${m}:`, text.slice(0, 20));
     } catch (e) {
       console.log(`Error for ${m}:`, e.message || e);
     }
  }
}

main();
