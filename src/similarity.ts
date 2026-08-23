export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) {
    return 0;
  }
  return dot / denom;
}

export function rankByCosine<T extends { vector: number[] }>(
  postVector: number[],
  candidates: T[],
): (T & { similarity: number; rank: number })[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      similarity: cosine(postVector, candidate.vector),
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}
