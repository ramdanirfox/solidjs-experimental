export const DeckGLUtils = {
    pathArc: function (datum: any, segmentCount = 50, smoothAlt = true, smoothPosition = true) {
        const { pickup, dropoff, height } = datum

        // Based on https://github.com/visgl/deck.gl/blob/master/modules/layers/src/arc-layer/arc-layer-vertex.glsl.ts
        const mix = (from: number, to: number, t: number) => from + (to - from) * t

        const mixspace = (start: number, end: number, mixAmount: number[]) =>
            mixAmount.map((amount) => mix(start, end, amount))

        const paraboloid = (
            height: number,
            sourceZ: number = 0, // ground = 0
            targetZ: number = 0, // ground = 0
            ratio: number,
            scaleHeight = 1.0
        ) => {
            // d: distance on the xy plane
            // r: ratio of the current point
            // p: ratio of the peak of the arc
            // h: height multiplier
            // z = f(r) = sqrt(r * (p * 2 - r)) * d * h
            // f(0) = 0
            // f(1) = dz

            const deltaZ = targetZ - sourceZ
            const dh = height * scaleHeight
            if (dh === 0) return sourceZ + deltaZ * ratio

            const unitZ = deltaZ / dh
            const p2 = unitZ * unitZ + 1.0

            // sqrt does not deal with negative values, manually flip source and target if delta.z < 0
            const dir = 0 < deltaZ ? 0 : 1
            const z0 = mix(sourceZ, targetZ, dir)
            const r = mix(ratio, 1.0 - ratio, dir)
            return Math.sqrt(r * (p2 - r)) * dh + z0
        }
        // From there you'll also need the segment ratios functions to loop through this and build out lng/lat/alt points
        const clamp = (x: number, lower: number, upper: number) =>
            Math.max(lower, Math.min(x, upper))

        const range = (stop: number) => Array.from({ length: stop }, (_, i) => i)

        const smoothstep = (edge0: number, edge1: number, x: number) => {
            // Scale, bias and saturate x to 0..1 range
            x = clamp((x - edge0) / (edge1 - edge0), 0, 1)
            return x * x * (3 - 2 * x)
        }

        const segmentRatios = (segmentCount: number = 100, smooth: boolean = true) => {
            return range(segmentCount).map(
                smooth
                    ? (x) => smoothstep(0, 1, x / (segmentCount - 1))
                    : (x) => mix(0, 1, x / (segmentCount - 1))
            )
        }

        // Generate geometry given an pickup and dropoff
        const altSteps = segmentRatios(segmentCount, smoothAlt)
        const alts = altSteps.map((altStep) =>
            paraboloid(height, pickup[2], dropoff[2], altStep)
        )

        const positionSteps = segmentRatios(segmentCount, smoothPosition)

        const lngs = mixspace(pickup[0], dropoff[0], positionSteps)
        const lats = mixspace(pickup[1], dropoff[1], positionSteps)

        return alts.map((alt, idx) => [lngs[idx], lats[idx], alt])
    }

}