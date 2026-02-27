import React, { useState, useRef, useEffect } from "react";
import { useCadCore } from "../contexts/CoreContext";

const FileMenu: React.FC = () => {
  const { elements, importFile, exportFile, mode, activeSketch, isOperationPending } = useCadCore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isLocked = (mode === "sketch" && !!activeSketch) || isOperationPending;
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasElements = elements.length > 0;

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Clear error after 4 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
    setMenuOpen(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      await importFile(file);
    } catch (err) {
      console.error("Import failed:", err);
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      // Reset input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async (format: "step" | "stl" | "iges") => {
    setMenuOpen(false);
    setLoading(true);
    setError(null);
    try {
      await exportFile(format);
    } catch (err) {
      console.error("Export failed:", err);
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="relative flex-none" ref={menuRef}>
        <button
          className={`px-3 py-1.5 text-sm rounded flex items-center gap-1 ${
            loading ? "bg-gray-600 text-gray-400 cursor-wait"
              : isLocked ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-gray-700 hover:bg-gray-600 text-gray-200"
          }`}
          onClick={() => !loading && !isLocked && setMenuOpen(!menuOpen)}
          disabled={loading || isLocked}
        >
          {loading ? "Working..." : "File"}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-lg py-1 z-30 min-w-[200px]">
            <button
              className="w-full px-4 py-2 text-sm text-left hover:bg-gray-700 text-gray-200"
              onClick={handleImportClick}
            >
              Import...
            </button>
            <div className="border-t border-gray-600 my-1" />
            <button
              className={`w-full px-4 py-2 text-sm text-left text-gray-200 ${
                hasElements ? "hover:bg-gray-700" : "text-gray-500 cursor-not-allowed"
              }`}
              disabled={!hasElements}
              onClick={() => handleExport("step")}
            >
              Export as STEP (.step)
            </button>
            <button
              className={`w-full px-4 py-2 text-sm text-left text-gray-200 ${
                hasElements ? "hover:bg-gray-700" : "text-gray-500 cursor-not-allowed"
              }`}
              disabled={!hasElements}
              onClick={() => handleExport("stl")}
            >
              Export as STL (.stl)
            </button>
            <button
              className={`w-full px-4 py-2 text-sm text-left text-gray-200 ${
                hasElements ? "hover:bg-gray-700" : "text-gray-500 cursor-not-allowed"
              }`}
              disabled={!hasElements}
              onClick={() => handleExport("iges")}
            >
              Export as IGES (.iges)
            </button>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".step,.stp,.stl"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-800 text-white px-4 py-2 rounded-md shadow-lg z-50 text-sm max-w-sm">
          {error}
        </div>
      )}
    </>
  );
};

export default FileMenu;
