import { useEffect, useMemo, useState } from "react";
import { Canvas, Fill, Shader, Skia } from "react-skia-lite";

const shaderCode = `
uniform float iTime;

// 伪随机函数
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 噪声函数
float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec4 main(vec2 pos) {
  // 归一化坐标
  vec2 uv = pos / vec2(256.0);
  
  // 深色背景（夜晚天空）
  vec3 color = vec3(0.05, 0.05, 0.15);
  
  // 创建多层雪花
  float snow = 0.0;
  
  // 多层雪花效果，不同大小和速度
  for (int i = 0; i < 50; i++) {
    float id = float(i);
    vec2 snowPos = vec2(
      fract(random(vec2(id)) + iTime * (0.3 + random(vec2(id * 0.7)) * 0.2)),
      fract(random(vec2(id * 1.3)) + iTime * (0.5 + random(vec2(id * 0.9)) * 0.3))
    );
    
    // 雪花大小
    float size = 0.01 + random(vec2(id * 2.1)) * 0.02;
    
    // 计算距离
    float dist = distance(uv, snowPos);
    
    // 雪花形状（圆形，带一些模糊）
    float flake = smoothstep(size, size * 0.3, dist);
    
    // 根据层数调整亮度
    float brightness = 0.5 + random(vec2(id * 3.7)) * 0.5;
    snow += flake * brightness;
  }
  
  // 添加一些额外的随机雪花点
  for (int i = 0; i < 30; i++) {
    float id = float(i + 50);
    vec2 snowPos = vec2(
      fract(random(vec2(id * 1.7)) + iTime * 0.4),
      fract(random(vec2(id * 2.3)) + iTime * 0.6)
    );
    float size = 0.005 + random(vec2(id * 1.9)) * 0.01;
    float dist = distance(uv, snowPos);
    float flake = smoothstep(size, size * 0.2, dist);
    snow += flake * 0.3;
  }
  
  // 添加整体噪声作为背景雪花
  float backgroundSnow = noise(uv * 20.0 + iTime * 0.5) * 0.1;
  snow += backgroundSnow;
  
  // 混合雪花到背景
  color += vec3(snow);
  
  return vec4(color, 1.0);
}`;

const SimpleShader = () => {
	const [time, setTime] = useState(0);

	// 延迟创建 shader source，确保 Skia 已加载
	const source = useMemo(() => {
		try {
			return Skia.RuntimeEffect.Make(shaderCode);
		} catch (error) {
			console.error("Failed to create shader:", error);
			return null;
		}
	}, []);

	useEffect(() => {
		const startTime = Date.now();
		const interval = setInterval(() => {
			setTime((Date.now() - startTime) / 1000);
		}, 16); // ~60fps
		return () => clearInterval(interval);
	}, []);

	if (!source) {
		return (
			<div
				style={{
					width: 256,
					height: 256,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<p>加载 Shader 中...</p>
			</div>
		);
	}

	return (
		<Canvas style={{ width: 256, height: 256 }}>
			<Fill>
				<Shader source={source} uniforms={{ iTime: time }} />
			</Fill>
		</Canvas>
	);
};

export default SimpleShader;
