import React from "react";

interface LoadingScreenProps {
  error?: string | null;
  onRetry?: () => void;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ error, onRetry }) => {
  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
      <div className="flex flex-col items-center">
        {error ? (
          <>
            <div className="text-red-400 text-sm mb-4 max-w-xs text-center">
              {error}
            </div>
            <button
              onClick={onRetry}
              className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md
                         transition-colors cursor-pointer"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-3 border-gray-600 border-t-blue-400 rounded-full animate-spin mb-4" />
            <div className="text-gray-300 text-sm">Loading...</div>
          </>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;
