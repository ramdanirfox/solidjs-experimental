import { Component, onMount } from "solid-js";

export interface ISharedMaplibreLayerWrapperProps {
    jsxLayer: any;
    Layer: any;
} 

const SharedMaplibreLayerWrapper: Component<ISharedMaplibreLayerWrapperProps> = (props) => {
    onMount(() => {
        console.log("Hook Children", props);
    });
    // console.log("Hook Children 2", props.children);
    return <>
    {props.jsxLayer}
    </>  
}

export default SharedMaplibreLayerWrapper;