import { Tesseract } from 'tesseract.js';

let ocrWorker = null;

async function initOcr() {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await Tesseract.createWorker();
  return ocrWorker;
}

export async function extractScoreFromCanvas(canvas) {
  try {
    if (!canvas || !canvas.width || !canvas.height) {
      return null;
    }

    const worker = await initOcr();

    // Crop to bottom-right area where scores typically are (adjust as needed)
    const cropWidth = Math.min(300, canvas.width / 3);
    const cropHeight = Math.min(150, canvas.height / 4);
    const cropX = canvas.width - cropWidth;
    const cropY = canvas.height - cropHeight;

    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(cropX, cropY, cropWidth, cropHeight);

    // Enhance contrast for better OCR
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = data[i + 1] = data[i + 2] = gray > 128 ? 255 : 0;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropWidth;
    tempCanvas.height = cropHeight;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

    const result = await worker.recognize(tempCanvas);
    const text = result.data.text;

    // Extract numbers from OCR result
    const numbers = text.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      const score = parseInt(numbers[numbers.length - 1], 10);
      return isNaN(score) ? null : score;
    }

    return null;
  } catch (error) {
    console.error('OCR error:', error);
    return null;
  }
}

export function cleanupOcr() {
  if (ocrWorker) {
    ocrWorker.terminate();
    ocrWorker = null;
  }
}
