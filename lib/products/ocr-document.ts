export type OcrPoint = {
  x: number;
  y: number;
};

export type OcrBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type OcrWord = {
  text: string;
  confidence: number | null;
  box: OcrBox;
};

export type OcrLine = {
  text: string;
  words: OcrWord[];
  box: OcrBox;
};

export type OcrDocument = {
  provider: string;
  text: string;
  width: number | null;
  height: number | null;
  words: OcrWord[];
  lines: OcrLine[];
};

function unionBox(boxes: OcrBox[]): OcrBox {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

function wordHeight(word: OcrWord) {
  return Math.max(1, word.box.maxY - word.box.minY);
}

function centerY(word: OcrWord) {
  return (word.box.minY + word.box.maxY) / 2;
}

function shouldJoinLine(line: OcrWord[], word: OcrWord) {
  if (line.length === 0) return true;
  const averageCenter = line.reduce((sum, candidate) => sum + centerY(candidate), 0) / line.length;
  const averageHeight = line.reduce((sum, candidate) => sum + wordHeight(candidate), 0) / line.length;
  return Math.abs(centerY(word) - averageCenter) <= Math.max(8, averageHeight * 0.65);
}

function joinWords(words: OcrWord[]) {
  const sorted = [...words].sort((a, b) => a.box.minX - b.box.minX);
  return sorted.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}

export function groupOcrWordsIntoLines(words: OcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => {
    const y = centerY(a) - centerY(b);
    return Math.abs(y) > 4 ? y : a.box.minX - b.box.minX;
  });

  const rows: OcrWord[][] = [];
  for (const word of sorted) {
    let target: OcrWord[] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      if (!shouldJoinLine(row, word)) continue;
      const rowCenter = row.reduce((sum, candidate) => sum + centerY(candidate), 0) / row.length;
      const distance = Math.abs(centerY(word) - rowCenter);
      if (distance < bestDistance) {
        target = row;
        bestDistance = distance;
      }
    }

    if (target) target.push(word);
    else rows.push([word]);
  }

  return rows
    .filter((row) => row.length > 0)
    .map((row) => ({
      text: joinWords(row),
      words: [...row].sort((a, b) => a.box.minX - b.box.minX),
      box: unionBox(row.map((word) => word.box)),
    }))
    .sort((a, b) => {
      const ay = (a.box.minY + a.box.maxY) / 2;
      const by = (b.box.minY + b.box.maxY) / 2;
      return ay - by;
    });
}
