declare module 'maplibre-google-maps' {
  interface GoogleProtocolParams {
    url: string;
  }

  interface GoogleProtocolResponse {
    data: ArrayBuffer;
  }

  interface CreateGoogleStyleParams {
    id: string;
    mapType: string;
    key: string;
  }

  interface GoogleStyle {
    version: number;
    sources: { [key: string]: any };
    layers: any[];
  }

  export function googleProtocol(params: GoogleProtocolParams, abortController: AbortController): Promise<GoogleProtocolResponse>;

  export function createGoogleStyle(id: string, mapType: string, key: string): GoogleStyle;
}