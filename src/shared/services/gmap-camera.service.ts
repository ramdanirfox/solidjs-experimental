import { Easing, Group, Tween } from "@tweenjs/tween.js";

export interface GMapCameraFlyToAPI {
    isStopped: () => boolean,
    stopAnimation: () => void
}

export interface GMapCameraService {
    fnFlyTo: (targetpos: { lng: number, lat: number, zoom: number, duration?: number }) => GMapCameraFlyToAPI,
    fnCalculateMaxArcZoom: (
        camera1: { center: google.maps.LatLngLiteral; zoom: number },
        camera2: { center: google.maps.LatLngLiteral; zoom: number },
        arcFactor: number
    ) => number,
    fnCalculateFlyDuration: (
        camera1: { center: google.maps.LatLngLiteral; zoom: number },
        camera2: { center: google.maps.LatLngLiteral; zoom: number }
    ) => number,
    fnFlyToBounds: (
        bbox: [[number, number], [number, number]],
        cameraOption?: { tilt?: number; heading?: number; padding?: number, useFlyTo?: boolean }
    ) => GMapCameraFlyToAPI
}

export const GMapCameraServiceFactory = (googleref: any, gmapref: any) => {
    const fnFlyTo = (targetpos: { lng: number, lat: number, zoom: number, duration?: number }): GMapCameraFlyToAPI => {
        const map = gmapref as unknown as google.maps.Map;
        const pos = map.getCenter();
        const cameraOptions: google.maps.CameraOptions = {
            tilt: map.getTilt(),
            heading: map.getHeading(),
            zoom: map.getZoom(),
            center: { lat: pos?.lat() || 0, lng: pos?.lng() || 0 },
        };

        let animationFrameId: number;
        const time = targetpos.duration || 3000;
        const halfTime = time / 1.5;

        // Initial and target camera options
        const startCamera = {
            tilt: cameraOptions.tilt,
            heading: cameraOptions.heading,
            zoom: cameraOptions.zoom,
            center: { ...cameraOptions.center },
            arc: 0
        };
        const targetCamera = {
            tilt: 0,
            heading: 0,
            zoom: targetpos.zoom,
            center: { lat: targetpos.lat, lng: targetpos.lng },
            arc: 1
        };

        // Tween 1: animate center in half the time
        const centerObj = { ...startCamera.center, arc: startCamera.arc };
        const tweenCenter = new Tween(centerObj)
            .to({ ...targetCamera.center, arc: targetCamera.arc }, halfTime)
            .easing(Easing.Quintic.Out)
            .onUpdate((current) => {
                const tweenedLat = (1 - current.arc) * (startCamera as any).center!.lat + current.arc * (targetCamera as any).center.lat;
                const tweenedLng = (1 - current.arc) * (startCamera as any).center!.lng + current.arc * (targetCamera as any).center.lng;

                // map.moveCamera({ center: { ...centerObj } as any });
                // center: { lat: tweenedLat, lng: tweenedLng },
                map.moveCamera({ center: { lat: tweenedLat, lng: tweenedLng } as any });
            });

        // Tween 2: animate tilt, heading, zoom in full time
        const otherObj1 = {
            tilt: startCamera.tilt,
            heading: startCamera.heading,
            zoom: startCamera.zoom,
            arc: startCamera.arc
        };
        const otherObj2 = {
            tilt: targetCamera.tilt,
            heading: targetCamera.heading,
            zoom: targetCamera.zoom,
            arc: targetCamera.arc
        };
        const tweenOther = new Tween(otherObj1)
            .to(otherObj2, time)
            .easing(Easing.Cubic.Out)
            .onUpdate((current) => {
                const arcFactor = -0.7; // You can make this an option in fnFlyToBounds
                const maxArcZoom = fnCalculateMaxArcZoom(startCamera as any, targetCamera as any, arcFactor);
                // const maxArcZoom = Math.max(camera1.zoom!, camera2.zoom!) - 3; // Zoom out more in the middle
                const arcZoom = maxArcZoom - Math.pow(current.arc * 2 - 1, 2) * (maxArcZoom - current.zoom!);
                // const arcZoom = maxArcZoom - Math.pow(current.arc * 2 - 1, 2) * (maxArcZoom - (camera2 as any).zoom); // Corrected line

                map.moveCamera({
                    zoom: arcZoom,
                    tilt: current.tilt,
                    heading: current.heading
                });
                // map.moveCamera({ ...otherObj });
            });

        // Group both tweens
        const group = new Group();
        group.add(tweenCenter);
        group.add(tweenOther);

        tweenCenter.start();
        tweenOther.start();

        function animate(time: number) {
            if (group.allStopped()) return;
            animationFrameId = requestAnimationFrame(animate);
            // tweenCenter.update(time);
            // tweenOther.update(time);
            group.update(time);
        }

        animationFrameId = requestAnimationFrame(animate);
        let api = {
            isStopped: () => group.allStopped(),
            stopAnimation: () => {
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                }
                if (tweenCenter && tweenCenter.isPlaying()) {
                    tweenCenter.stop();
                }
                if (tweenOther && tweenOther.isPlaying()) {
                    tweenOther.stop();
                }
            } // need to finish this function
        }
        return api;
    };
    const fnCalculateMaxArcZoom = (
        camera1: { center: google.maps.LatLngLiteral; zoom: number },
        camera2: { center: google.maps.LatLngLiteral; zoom: number },
        arcFactor: number = 1
    ): number => {
        const googleRef = googleref;
        const from = new googleRef.maps.LatLng(camera1.center);
        const to = new googleRef.maps.LatLng(camera2.center);

        // Calculate the distance in kilometers between the two points
        const distanceKm = googleRef.maps.geometry.spherical.computeDistanceBetween(from, to) / 1000;

        // Use a logarithmic scale for distance to get a smooth, non-linear relationship
        const distanceScale = Math.log(distanceKm + 1);

        // Factor in the zoom difference to make the arc more pronounced for large changes
        const zoomDiff = Math.abs(camera1.zoom - camera2.zoom);

        // The base arc is proportional to the distance and zoom difference, adjusted by the factor
        const arcHeight = (distanceScale + zoomDiff) * arcFactor;

        return Math.max(camera1.zoom, camera2.zoom) + arcHeight;
    }

    const fnCalculateFlyDuration = (
        camera1: { center: google.maps.LatLngLiteral; zoom: number },
        camera2: { center: google.maps.LatLngLiteral; zoom: number }
    ): number => {
        const googleRef = googleref;
        const from = new googleRef.maps.LatLng(camera1.center);
        const to = new googleRef.maps.LatLng(camera2.center);

        const distanceKm = googleRef.maps.geometry.spherical.computeDistanceBetween(from, to) / 1000;
        const zoomDiff = Math.abs(camera1.zoom - camera2.zoom);

        // Use a base duration (e.g., 1000ms) and add time for distance and zoom changes
        const baseDuration = 1000;
        const distanceTime = Math.log(distanceKm + 1) * 500; // Add 200ms per unit of log-distance
        const zoomTime = zoomDiff * 100; // Add 100ms per unit of zoom difference

        const duration = baseDuration + distanceTime + zoomTime;

        // Cap the duration to prevent excessively long animations (e.g., 5 seconds)
        return Math.min(duration, 5000);
    }

    const fnFlyToBounds = (
        bbox: [[number, number], [number, number]],
        cameraOption?: { tilt?: number; heading?: number; padding?: number, useFlyTo?: boolean }
    ) => {
        const map = gmapref as unknown as google.maps.Map;
        const googleRef: any = googleref;
        if (!map || !googleRef || !bbox || bbox.length !== 2) return {
            isStopped: () => true,
            stopAnimation: () => { }
        };

        // Calculate bounds
        const [lng1, lat1] = bbox[0];
        const [lng2, lat2] = bbox[1];
        const sw = { lat: Math.min(lat1, lat2), lng: Math.min(lng1, lng2) };
        const ne = { lat: Math.max(lat1, lat2), lng: Math.max(lng1, lng2) };
        const bounds = new googleRef.maps.LatLngBounds(sw, ne);

        // Calculate center
        const center = bounds.getCenter().toJSON();

        // Estimate zoom to fit bounds (simple heuristic, not perfect)
        // You may want to improve this with a more accurate calculation
        const WORLD_DIM = { height: 256, width: 256 };
        const ZOOM_MAX = 21;

        function latRad(lat: number) {
            const sin = Math.sin(lat * Math.PI / 180);
            const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
            return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
        }

        function getBoundsZoom(bounds: any, mapDim: { height: number, width: number }, padding: number) {
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();

            const latFraction = (latRad(ne.lat()) - latRad(sw.lat())) / Math.PI;
            const lngDiff = ne.lng() - sw.lng();
            const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;

            const latZoom = Math.log(mapDim.height / padding / WORLD_DIM.height / latFraction) / Math.LN2;
            const lngZoom = Math.log(mapDim.width / padding / WORLD_DIM.width / lngFraction) / Math.LN2;

            return Math.min(latZoom, lngZoom, ZOOM_MAX);
        }

        /**
         * Calculates a dynamic max arc zoom based on distance and zoom difference.
         * @param camera1 The starting camera
         * @param camera2 The target camera
         * @param arcFactor A multiplier to adjust the prominence of the arc (e.g., 0.5 to 2.0)
         * @returns The calculated max zoom for the arc's peak
         */

        const padding = cameraOption?.padding ?? 50;
        const mapDiv = map.getDiv();
        const mapDim = {
            width: mapDiv.offsetWidth || 800,
            height: mapDiv.offsetHeight || 600
        };
        const fitZoom = getBoundsZoom(bounds, mapDim, padding);

        // Animate camera to bounds

        const camera1 = {
            tilt: map.getTilt(),
            heading: map.getHeading(),
            zoom: map.getZoom(),
            center: map.getCenter()?.toJSON(),
            arc: 0
        };

        const camera2: google.maps.CameraOptions = {
            tilt: cameraOption?.tilt ?? map.getTilt(),
            heading: cameraOption?.heading ?? map.getHeading(),
            zoom: fitZoom,
            center,
            arc: 1
        } as any;

        // const twInstance = new Tween(camera1)
        //     .to(camera2, 15000)
        //     .easing(Easing.Quadratic.Out)
        //     .onUpdate((current) => {
        //         map.moveCamera(current);
        //     })
        //     .start();

        // --- NEW LOGIC FOR ARCING MOVEMENT ---
        const precalcDuration = fnCalculateFlyDuration(camera1 as any, camera2 as any);
        console.log("duration precalculation", precalcDuration);
        if (!cameraOption?.useFlyTo) {
            let animationFrameId: number;
            const twInstance = new Tween(camera1)
                .to(camera2, precalcDuration) // Shorter duration for a snappier feel
                .easing(Easing.Quadratic.Out)
                .onUpdate((current) => {
                    // Get interpolated values from the tween
                    const tweenedLat = (1 - current.arc) * camera1.center!.lat + current.arc * (camera2 as any).center.lat;
                    const tweenedLng = (1 - current.arc) * camera1.center!.lng + current.arc * (camera2 as any).center.lng;

                    // Calculate the arc's elevation (simple parabolic curve)
                    const arcFactor = -0.9; // You can make this an option in fnFlyToBounds
                    const maxArcZoom = fnCalculateMaxArcZoom(camera1 as any, camera2 as any, arcFactor);
                    // const maxArcZoom = Math.max(camera1.zoom!, camera2.zoom!) - 3; // Zoom out more in the middle
                    const arcZoom = maxArcZoom - Math.pow(current.arc * 2 - 1, 2) * (maxArcZoom - current.zoom!);
                    // const arcZoom = maxArcZoom - Math.pow(current.arc * 2 - 1, 2) * (maxArcZoom - (camera2 as any).zoom); // Corrected line

                    map.moveCamera({
                        center: { lat: tweenedLat, lng: tweenedLng },
                        zoom: arcZoom,
                        tilt: current.tilt,
                        heading: current.heading
                    });
                })
                .start();

            function animate(time: number) {
                if (!twInstance.isPlaying()) return;
                animationFrameId = requestAnimationFrame(animate);
                twInstance.update(time);
                console.log("animatingbbox");
            }

            animationFrameId = requestAnimationFrame(animate);

            let api = {
                isStopped: () => !twInstance.isPlaying(),
                stopAnimation: () => {
                    if (animationFrameId) {
                        cancelAnimationFrame(animationFrameId);
                    }
                    if (twInstance && twInstance.isPlaying()) {
                        twInstance.stop();
                    }
                } // need to finish this function
            }
            return api;
        }
        else {
            return fnFlyTo({
                lat: (camera2 as any).center?.lat,
                lng: (camera2 as any).center?.lng,
                zoom: (camera2 as any).zoom,
                duration: precalcDuration
            })
        }

    }

    return {
        fnFlyTo,
        fnCalculateMaxArcZoom,
        fnCalculateFlyDuration,
        fnFlyToBounds
    };
};