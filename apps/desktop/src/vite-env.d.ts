export {};

declare global {
  interface Window {
    ratecadDesktop?: {
      platform: string;
      onMenuAction: (handler: (action: string) => void) => () => void;
    };
  }
}
