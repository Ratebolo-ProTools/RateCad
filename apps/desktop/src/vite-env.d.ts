export {};

declare global {
  interface Window {
    ratecadDesktop?: {
      platform: string;
      onMenuAction: (handler: (action: string) => void) => () => void;
      openDrawing: () => Promise<{
        canceled?: boolean;
        filePath?: string;
        contents?: string;
        error?: string;
      }>;
      saveDrawing: (payload: {
        contents: string;
        filePath?: string | null;
        defaultPath?: string;
        forceDialog?: boolean;
      }) => Promise<{
        canceled?: boolean;
        filePath?: string;
        error?: string;
      }>;
      confirmDiscard: (message?: string) => Promise<boolean>;
    };
  }
}
