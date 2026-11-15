import { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { renderMasterpiece } from './art/masterpiece';
import { ART_HEIGHT, ART_WIDTH } from './art/paper';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) {
      renderMasterpiece(canvasRef.current);
    }
  }, []);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'jatayu-1920x1080.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <main className="min-h-screen w-full bg-[#121114] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-[1400px] flex flex-col items-end gap-3">
        <div className="w-full aspect-video bg-[#1B1817] shadow-[0_24px_70px_rgba(0,0,0,0.65)] overflow-hidden">
          <canvas
            ref={canvasRef}
            width={ART_WIDTH}
            height={ART_HEIGHT}
            className="block w-full h-full object-contain"
          />
        </div>

        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-stone-100 text-stone-900 hover:bg-white transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download PNG</span>
        </button>
      </div>
    </main>
  );
}
