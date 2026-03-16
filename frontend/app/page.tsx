"use client";

import { useEffect, useRef } from "react";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const SQUARE = 4;
    const GAP = 6;
    const CELL = SQUARE + GAP;
    const COLOR = "15,15,15";
    const MAX_OPACITY = 0.12;
    const FLICKER_CHANCE = 0.06;

    let cols: number, rows: number, squares: Float32Array;
    let rafId: number;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      cols = Math.ceil(canvas!.width / CELL) + 1;
      rows = Math.ceil(canvas!.height / CELL) + 1;
      squares = new Float32Array(cols * rows);
      for (let i = 0; i < squares.length; i++) {
        squares[i] = Math.random() * MAX_OPACITY;
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (Math.random() < FLICKER_CHANCE) {
            squares[idx] = Math.random() * MAX_OPACITY;
          }
          const op = squares[idx];
          if (op < 0.002) continue;
          ctx!.fillStyle = `rgba(${COLOR},${op.toFixed(3)})`;
          ctx!.fillRect(c * CELL, r * CELL, SQUARE, SQUARE);
        }
      }
      rafId = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-white flex flex-col items-center justify-center">
      {/* Flickering grid */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
      />

      {/* Content */}
      <div className="relative flex flex-col items-center text-center px-6" style={{ zIndex: 1 }}>
        <h1
          style={{
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: "clamp(52px, 10vw, 100px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "#0f0f0f",
            marginBottom: "14px",
          }}
        >
          Textpot
        </h1>

        <p
          style={{
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: "clamp(15px, 2vw, 19px)",
            color: "#6b6b6b",
            marginBottom: "16px",
            letterSpacing: "-0.01em",
          }}
        >
          Social media sentiment intelligence.
        </p>

        {/* Coming soon pill */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "9px",
            padding: "11px 20px",
            background: "#ffffff",
            border: "1.5px solid #e3e3e3",
            borderRadius: "999px",
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: "13px",
            fontWeight: 500,
            color: "#6b6b6b",
            boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
            letterSpacing: "-0.01em",
            marginBottom: "24px",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#0f0f0f" strokeWidth="2"/>
            <circle cx="12" cy="12" r="4" fill="#0f0f0f"/>
            <line x1="12" y1="2" x2="12" y2="8" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round"/>
            <line x1="20.5" y1="16.5" x2="15.2" y2="13.5" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3.5" y1="16.5" x2="8.8" y2="13.5" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Chrome extension — coming soon
        </div>

        <p
          style={{
            fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: "clamp(13px, 1.6vw, 16px)",
            color: "#ababab",
            marginBottom: "52px",
            letterSpacing: "-0.01em",
            maxWidth: "480px",
          }}
        >
          Comment sections are where the real customer data lives.
          <br />
          You can now read them all at once.
        </p>

        {/* Demo video */}
        <div
          style={{
            width: "100%",
            maxWidth: "720px",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 4px 40px rgba(0,0,0,0.10)",
            border: "1px solid #e3e3e3",
          }}
        >
          <iframe
            width="100%"
            style={{ aspectRatio: "16/9", display: "block" }}
            src="https://www.youtube.com/embed/iszlsOHUzAk"
            title="Textpot demo"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </main>
  );
}
