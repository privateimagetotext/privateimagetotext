export function normaliseForComparison(value: string) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n");
}

function toCodePoints(value: string) {
  return Array.from(value);
}

export function levenshteinDistance<T>(reference: readonly T[], actual: readonly T[]) {
  if (reference.length === 0) return actual.length;
  if (actual.length === 0) return reference.length;

  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      const substitutionCost =
        reference[referenceIndex - 1] === actual[actualIndex - 1] ? 0 : 1;
      current[actualIndex] = Math.min(
        current[actualIndex - 1] + 1,
        previous[actualIndex] + 1,
        previous[actualIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[actual.length];
}

function errorRate(reference: readonly string[], actual: readonly string[]) {
  if (reference.length === 0) return actual.length === 0 ? 0 : 1;
  return levenshteinDistance(reference, actual) / reference.length;
}

export function strictCharacterErrorRate(reference: string, actual: string) {
  return errorRate(
    toCodePoints(normaliseForComparison(reference)),
    toCodePoints(normaliseForComparison(actual)),
  );
}

export function normaliseWhitespace(value: string) {
  return normaliseForComparison(value).replace(/\s+/gu, " ").trim();
}

export function whitespaceNormalisedCharacterErrorRate(
  reference: string,
  actual: string,
) {
  return strictCharacterErrorRate(
    normaliseWhitespace(reference),
    normaliseWhitespace(actual),
  );
}

function words(value: string) {
  const normalised = normaliseWhitespace(value);
  return normalised ? normalised.split(" ") : [];
}

export function wordErrorRate(reference: string, actual: string) {
  return errorRate(words(reference), words(actual));
}

export type CriticalTokenResult = {
  matched: number;
  total: number;
  rate: number;
  missing: string[];
};

export function matchCriticalTokens(
  expectedTokens: readonly string[],
  actual: string,
): CriticalTokenResult {
  const normalisedActual = normaliseForComparison(actual);
  const actualCounts = new Map<string, number>();
  for (const token of new Set(expectedTokens.map(normaliseForComparison))) {
    if (token.length === 0) {
      actualCounts.set(token, 0);
      continue;
    }
    let count = 0;
    let searchFrom = 0;
    while (searchFrom <= normalisedActual.length - token.length) {
      const foundAt = normalisedActual.indexOf(token, searchFrom);
      if (foundAt === -1) break;
      count += 1;
      searchFrom = foundAt + token.length;
    }
    actualCounts.set(token, count);
  }

  const missing: string[] = [];
  let matched = 0;
  for (const token of expectedTokens.map(normaliseForComparison)) {
    const remaining = actualCounts.get(token) ?? 0;
    if (remaining > 0) {
      matched += 1;
      actualCounts.set(token, remaining - 1);
    } else {
      missing.push(token);
    }
  }

  return {
    matched,
    total: expectedTokens.length,
    rate: expectedTokens.length === 0 ? 1 : matched / expectedTokens.length,
    missing,
  };
}

export function measureOcrAccuracy(
  reference: string,
  actual: string,
  criticalTokens: readonly string[],
) {
  return {
    strictCer: strictCharacterErrorRate(reference, actual),
    whitespaceNormalisedCer: whitespaceNormalisedCharacterErrorRate(
      reference,
      actual,
    ),
    wer: wordErrorRate(reference, actual),
    criticalTokens: matchCriticalTokens(criticalTokens, actual),
  };
}
