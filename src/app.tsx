import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createSignal, ErrorBoundary, Suspense } from "solid-js";
import { SJXProvider } from "./shared/context/SJXContext";
import { APP_DEV_BASEURL } from "./shared/constants/app.constant";
import SJXRootContainer from "./app-root";

export default function App() {
  const [sigNavigateCounter, setSigNavigateCounter] = createSignal(0);
  const [sigNavigateUrl, setSigNavigateUrl] = createSignal("");
  const fnTransformUrl = (url: string) => {
    // DONT put blocking/async code here, prerendering may fails
    console.log("Transforming URL: " + url);
    setSigNavigateUrl(url);
    setSigNavigateCounter(c => c + 1);
    // console.log("Environments: ", import.meta.env);
    const sub = url;
    const hasUrl = !!sub;
    const isNotContainBaseUrl = !sub?.includes(APP_DEV_BASEURL);
    const isCfgNotRootBaseUrl = (APP_DEV_BASEURL + "") != "/";
    console.log("Conditions: ", { hasUrl, isNotContainBaseUrl, isNotRootBaseUrl: isCfgNotRootBaseUrl });
    // if (sub && isNotContainBaseUrl && isCfgNotRootBaseUrl) {
    //   return APP_DEV_BASEURL + url;
    // }
    // else {
    return url;
    // }
  }

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <>
        <div>
          Error | Uncaught Client Exception
        </div>
        <div>
          <p>{error.message}</p>
          <button onClick={reset}>Retry</button>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
        </>
      )}
    >
      <Router
        base={APP_DEV_BASEURL}
        transformUrl={fnTransformUrl}
        root={props => (
          <SJXProvider count={1}>
            <MetaProvider>
              <Title>SolidStart - with Vitest</Title>
              <SJXRootContainer
                sigNavigateUrl={sigNavigateUrl}
                sigNavigateCounter={sigNavigateCounter}
              >
                {props.children}
              </SJXRootContainer>
            </MetaProvider>
          </SJXProvider>
        )}
      >
        <FileRoutes />
      </Router>
    </ErrorBoundary>
  );
}
