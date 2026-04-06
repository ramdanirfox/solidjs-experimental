import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createSignal, Suspense } from "solid-js";
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
    console.log("Environments: ", import.meta.env);
    return url;
  }

  return (
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
  );
}
