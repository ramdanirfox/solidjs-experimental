import { createSignal } from "solid-js";
import "./Counter.css";
import { useSJXContext } from "~/shared/context/SJXContext";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const SJXCtx = useSJXContext();
  return (
    <button class="increment" onClick={() => {
      setCount(count() + 1);
      SJXCtx?.ctx.increments.set(count())
    }} type="button">
      Clicks: {count()}
    </button>
  );
}
