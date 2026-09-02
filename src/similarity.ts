/** Cosine similarity over the shared prefix; extra entries in the longer vector are ignored. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const rest = b.values();
  for (const x of a) {
    const next = rest.next();
    if (next.done) {
      break;
    }
    const y = next.value;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA * normB);
  return denom === 0 ? 0 : dot / denom;
}

export function rankByCosine<T extends { vector: number[] }>(
  postVector: number[],
  candidates: T[],
): (T & { similarity: number; rank: number })[] {
  return candidates
    .map((candidate) => ({ ...candidate, similarity: cosine(postVector, candidate.vector) }))
    .sort((left, right) => right.similarity - left.similarity)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
