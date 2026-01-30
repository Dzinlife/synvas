import { useState } from "react";
import {
	BackdropBlur,
	Canvas,
	Circle,
	Fill,
	Group,
	Image,
	ImageShader,
	LinearGradient,
	Mask,
	Rect,
	RoundedRect,
	rect,
	Shader,
	Skia,
	useImage,
	vec,
} from "react-skia-lite";

const glsl = (source: TemplateStringsArray, ...values: Values) => {
	const processed = source.flatMap((s, i) => [s, values[i]]).filter(Boolean);
	return processed.join("");
};

const generateShader = () => {
	const sampleSize = 4;
	const blurLadder1 = 0.4;
	const blurLadder2 = 1.0;

	const shadowLadder = 0.4;

	const source = glsl`
	uniform shader image;
	uniform vec2 resolution;
  
	float Gaussian(float x, float sigma) {
	  return exp(-(x * x) / (2.0 * sigma * sigma));
	}
  
	vec4 blur(vec2 uv, float sigma) {
		vec4 colorSum = vec4(0.0);
		float weightSum = 0.0;
  
		for (int i = -${sampleSize}; i <= ${sampleSize}; ++i) {
			for (int j = -${sampleSize}; j <= ${sampleSize}; ++j) {
				vec2 offset = vec2(float(i), float(j)) / resolution.xy;
				vec2 sampleUV = uv + offset;        
				float weight = Gaussian(float(i), sigma) * Gaussian(float(j), sigma);
				colorSum += image.eval(sampleUV * resolution.xy) * weight;
				weightSum += weight;        
			}
		}
		return colorSum / weightSum;
	}
  
	half4 main(float2 xy) {   
	  vec2 uv = xy / resolution.xy;
	  
	  float sigma = clamp(0.0, 1.0,(uv.y - ${blurLadder1}) / (${blurLadder2} - ${blurLadder1}));
  
	  // float b0 = 1.0 - sigma;
	  float b0 = 1.0 - step(0.0, sigma);
	  
	  float alpha = clamp(0.0, 1.0, (uv.y - ${shadowLadder}) / (1.0 - ${shadowLadder}));
	  
	  vec4 blurColor = blur(uv, sigma * sigma * 10.0);
	  vec4 imageColor = image.eval(uv * resolution.xy);
	  vec4 color = b0 * imageColor + (1.0 - b0) * blurColor;
	  vec4 black = vec4(0.,0.,0.,1.);
	  return mix(color, black, alpha);
	}`;

	return Skia.RuntimeEffect.Make(source);
};

export default function SkiaCircle() {
	const image = useImage("/logo512.png");
	const photo = useImage("/photo.jpeg");

	const source = generateShader();

	console.log(source);

	return (
		<div className="canvas-container">
			<h2>Skia Canvas Demo</h2>

			<Canvas style={{ width: 400, height: 300 }}>
				<Group>
					{/* 渐变背景圆 */}
					<Circle cx={200} cy={150} r={120}>
						<LinearGradient
							start={vec(80, 30)}
							end={vec(320, 270)}
							colors={["#00d4ff", "#7b2cbf", "#f472b6"]}
						/>
					</Circle>

					{/* 内部装饰圆 */}
					<Circle cx={200} cy={150} r={80} color="rgba(255, 255, 255, 0.15)" />
					<Circle cx={200} cy={150} r={40} color="rgba(255, 255, 255, 0.25)" />

					{/* 中心点 */}
					<Circle cx={200} cy={150} r={8} color="#ffffff" />

					<BackdropBlur blur={10} clip={rect(100, 100, 200, 50)}>
						<RoundedRect
							x={100}
							y={100}
							width={200}
							height={50}
							color="white"
							opacity={0.3}
							r={10}
						/>
						<Image image={image} x={100} y={100} width={50} height={50} />
					</BackdropBlur>
					<Mask
						mask={<Rect x={0} y={0} width={200} height={200} color="white" />}
					>
						<Fill>
							<Shader source={source!} uniforms={{ resolution: [200, 200] }}>
								<ImageShader
									image={photo}
									fit={"contain"}
									rect={rect(0, 0, 200, 300)}
								/>
							</Shader>
						</Fill>
					</Mask>
				</Group>
			</Canvas>
		</div>
	);
}
