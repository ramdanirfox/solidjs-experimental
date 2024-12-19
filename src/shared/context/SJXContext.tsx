import { createSignal, createContext, useContext, Accessor, Setter } from "solid-js";

export class SJXStaticModel {
  increments: number = 1;
};

type SJXStaticFields = keyof SJXStaticModel;

export class SJXContextModel {

  ctx: {
    [K in keyof SJXStaticModel]: {
      set: Setter<SJXStaticModel[K]>,
      val: Accessor<SJXStaticModel[K]>
    }
  } = {} as any;

  // generate sesuka hati kapanpun :) (Dynamic Model)
  dynCtx: {
    [k: string]: {
      set: Setter<any>,
      val: Accessor<any>
    }
  } = {};

  constructor() {

    const model = new SJXStaticModel();
    for (let k in model) {
      const kType = k as SJXStaticFields;
      if (model.hasOwnProperty(k)) {
        const [staticSignal, setStaticSignal] = createSignal<any>(model[kType]);
        this.ctx[kType] = {
          set: setStaticSignal,
          val: staticSignal
        };
      }
    }
  }

  // pke ini untuk generate ya :) (Dynamic Model)
  dynamicallyAllocateContext(id: string, defaultValue?: any) {
    const [dynSignal, setDynSignal] = createSignal<any>(defaultValue);
    this.dynCtx[id] = {
      set: setDynSignal,
      val: dynSignal
    };
  }

  generateStaticSignal<T extends keyof SJXStaticModel>(data: SJXStaticModel, key: SJXStaticFields): [Accessor<SJXStaticModel[T]>, Setter<SJXStaticModel[T]>] {
    return createSignal<SJXStaticModel[T]>(data[key]);
  }
}

// const SJXContext = createContext<SJXContextModel | undefined>(new SJXContextModel(), {name: "INAP_CTX_BBT"});
const SJXContext = createContext<SJXContextModel | undefined>(undefined, { name: "INAP_CTX_SJX" });

export interface ISJXProvider {
  count: number;
  anda_bisa_input_props_kesini?: string;
  children: any;
}

export function SJXProvider(props: ISJXProvider) {
  const contextModel = new SJXContextModel();
  console.log("[SJXContext] ", props.anda_bisa_input_props_kesini, contextModel);
  return (
    <SJXContext.Provider value={contextModel}>
      {props.children}
    </SJXContext.Provider>
  );
}

// export function useSJXContext() { const mem = useContext<SJXContextModel | undefined>(SJXContext); console.log("[CTXInner] ", mem); return mem; } // debugging purpose
export function useSJXContext() { return useContext<SJXContextModel | undefined>(SJXContext); }