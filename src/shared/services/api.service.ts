import ky, { Hooks, Options, Progress } from "ky";
import { APP_DEV_BASEURL } from "../constants/app.constant";

export const SJXApiService = {
    authToken: "cc",
    cfg: {
        // BASE_URI: environment.baseApiUrlMiddleware,
        BASE_URI: "/",
        // BASE_URI: "src/assets/json/",
        // BASE_URI_UAM: import.meta.env.VITE_PUBLIC_API_UAM_URL,
        // BASE_URI_HOMEPAGE: import.meta.env.VITE_PUBLIC_API_HOMEPAGE_URL,
        // VERSION_URI_UAM: "api/v1/",
        // BASE_FCGI_URI: import.meta.env.VITE_PUBLIC_API_FCGI_BASE_URL,
        IS_DEV: /* true */ import.meta.env.DEV,
        BASE_URI_DEV: APP_DEV_BASEURL + "/assets/json/",
        // BASE_URI_UAM_DEV: "src/assets/json/uam/",
        POSTFIX_URI_DEV: ".json",
        API_RETRIES: 2
    },
    detectStillAuthorized: function (res: any, context?: any /* context is equal to this */) {
        // console.log("[Ky VERBOSE] Checking", res, context);
        if (res.status == 401) {
            // const willRetry = confirm("Token is expired. Try to refresh token?");
            // if (willRetry) {
            //     attemptRefreshToken(
            //         (newTokenData: { accessToken: string; refreshToken: string }) => {
            //             console.log("[Ky ReAuth Cb] Try to patch token with this", newTokenData);
            //             context.setAuthToken(newTokenData.accessToken);
            //             console.log("[Ky ReAuth Cb] But we're stuck on informing UI about this change, please think to put some callback to be set in this big service object to be called");
            //         }
            //     ).then((res) => {
            //         console.log("[Ky ReAuth] Refresh Access Token But what to do now?", res);
            //     }).catch((err) => {
            //         console.log("[Ky ReAuth] Failed somehow", err);
            //     });
            // }
        }
        return true;
    },
    getHeaders: function (param?: { secure?: boolean, skipContentType?: boolean, append?: [string, string][] }): Headers {
        const headers = new Headers();
        if (this.authToken && param && param.secure) { headers.append("Authorization", "Bearer " + this.authToken); };
        if (!param || (param && !param.skipContentType)) { headers.append("content-type", "application/json") };
        if (param && param.append) {
            param.append.forEach(p => headers.append(p[0], p[1]));
        };
        headers.append("accept", "*/*");
        // console.log("Headers is ", headers, this.authToken, param);
        return headers;
    },
    fnKyOpts: function (url: string, _id: string): Options {
        const controller = this.fnAddControllerSignal(url);
        return {
            signal: controller.signal,
            timeout: 2147483647,
            onDownloadProgress: this.fnDownloadProgress,
            // onUploadProgress: this.fnUploadProgress, // REQUIRES HTTP/2 or QUIC to be enabled in server
            hooks: this.fnKyHooks(url),
            headers: this.getHeaders({ secure: false })
        }
    },
    controllerSignals: {} as { [key: string]: AbortController },
    fnKyHooks: function (_param: any) {
        return {
            afterResponse: [
                async (_request, _options, response) => {
                    this.detectStillAuthorized(response, this);
                    return response;
                }
            ]
        } as Hooks;
    },
    fnAddControllerSignal: function (id: string): AbortController {
        const ctl = new AbortController();
        this.controllerSignals[id] = ctl;
        return ctl;
    },
    setAuthToken: function (token: any) {
        this.authToken = token;
    },
    getCfg: function () {
        return this.cfg;
    },
    setCfg: function (param: any) {
        this.cfg = param;
    },
    fnDownloadProgress: function (progress: Progress, chunk: Uint8Array) {
        // console.log("downloading", progress.totalBytes);
    },
    fnUploadProgress: function (progress: Progress, chunk: Uint8Array) {
        console.log("uploading", progress.totalBytes);
    },
    svcGetNetworkRouteData: function () {
        const url = `networking`;
        const finaldevurl = this.cfg.BASE_URI_DEV + url + this.cfg.POSTFIX_URI_DEV + "";
        console.log("final" , finaldevurl);
        const idreq = (new Date().getTime()).toString();
        const opts: Options = this.fnKyOpts(url, idreq);
        if (this.cfg.IS_DEV) { return ky.get(finaldevurl, opts).json() }
        else {
            return ky.get(this.cfg.BASE_URI + url, {
                ...opts
            }).json();
        }
    }
}