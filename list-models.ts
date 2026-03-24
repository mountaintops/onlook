async function listModels() {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyCVABT22H2MjA3okTjaxPfFb05EB2nBQAI';
  const data = await fetch(url).then(res => res.json());
  console.log("AVAILABLE MODELS:");
  if (!data.models) {
     console.log(data);
     return;
  }
  for (const m of data.models) {
     if (m.name.includes('flash') && m.name.includes('lite')) {
         console.log(m.name);
     }
  }
  console.log("ALL EXPERIMENTAL OR 2./3.* MODELS:");
  for (const m of data.models) {
     if (m.name.includes('2.') || m.name.includes('3.') || m.name.includes('exp')) {
         console.log(m.name);
     }
  }
}

listModels().catch(console.error);
