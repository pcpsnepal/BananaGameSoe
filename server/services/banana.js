// Client for the Banana API (https://marcconrad.com/uob/banana/doc.php): the only place that talks to it.
// base64=yes: the API returns the PNG itself, so the browser never has to contact the third-party image host.
const BANANA = 'https://marcconrad.com/uob/banana/api.php?out=json&base64=yes';

// Returns { image: <data URL>, solution: <digit 0-9> }. Throws if the service is unreachable or answers badly.
export async function fetchPuzzle() {
  const r = await fetch(BANANA);
  if (!r.ok) throw new Error(`Banana API ${r.status}`);
  const p = await r.json();
  return { image: `data:image/png;base64,${p.question}`, solution: p.solution };
}
