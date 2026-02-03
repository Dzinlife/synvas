import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	CanvasSink,
	Input,
	UrlSource,
	WrappedCanvas,
} from "mediabunny";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	Canvas,
	Fill,
	Group,
	Image,
	ImageShader,
	processTransform2d,
	rect,
	type SkImage,
	Skia,
} from "react-skia-lite";

interface SkiaVideoProps {
	url?: string;
	file?: File;
	width?: number;
	height?: number;
	autoPlay?: boolean;
}

export default function SkiaVideo({
	url = "/intro.mp4",
	file,
	width = 800,
	height = 450,
	autoPlay = true,
}: SkiaVideoProps) {
	const [currentFrameImage, setCurrentFrameImage] = useState<SkImage | null>(
		null,
	);
	const [isPlaying, setIsPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentVideoSource, setCurrentVideoSource] = useState<
		File | string | null
	>(null);

	const videoSinkRef = useRef<CanvasSink | null>(null);
	const audioSinkRef = useRef<AudioBufferSink | null>(null);
	const inputRef = useRef<Input | null>(null);
	const videoFrameIteratorRef = useRef<AsyncGenerator<
		WrappedCanvas,
		void,
		unknown
	> | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const gainNodeRef = useRef<GainNode | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const playbackTimeAtStartRef = useRef(0);
	const audioContextStartTimeRef = useRef<number | null>(null);
	const performanceStartTimeRef = useRef<number | null>(null);
	const asyncIdRef = useRef(0);
	const nextFrameRef = useRef<WrappedCanvas | null>(null);
	const isPlayingRef = useRef(false);
	const canvasContainerRef = useRef<HTMLDivElement | null>(null);
	const hoverSeekTimeoutRef = useRef<number | null>(null);
	const isInitializedRef = useRef(false);
	const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
	const isAudioPlayingRef = useRef(false);
	const pendingSeekTimeRef = useRef<number | null>(null);
	const mouseMoveRafRef = useRef<number | null>(null);
	const isSeekingRef = useRef(false);

	// 更新当前帧
	const updateFrame = useCallback(
		(canvas: HTMLCanvasElement | OffscreenCanvas) => {
			try {
				// 直接使用 Skia.Image.MakeImageFromNativeBuffer 从 canvas 创建 Image
				const skiaImage = Skia.Image.MakeImageFromNativeBuffer(canvas);
				if (skiaImage) {
					setCurrentFrameImage((prev) => {
						// prev?.dispose?.();
						return skiaImage;
					});
				}
			} catch (err) {
				console.error("更新帧失败:", err);
			}
		},
		[],
	);

	// 获取当前播放时间
	const getPlaybackTime = useCallback(() => {
		if (!isPlayingRef.current) {
			return playbackTimeAtStartRef.current;
		}

		// 如果有音频上下文，使用它来跟踪时间（更准确）
		if (audioContextRef.current && audioContextStartTimeRef.current !== null) {
			const elapsed =
				audioContextRef.current.currentTime - audioContextStartTimeRef.current;
			return playbackTimeAtStartRef.current + elapsed;
		}

		// 如果没有音频上下文，使用 performance.now() 来跟踪时间
		if (performanceStartTimeRef.current !== null) {
			const elapsed =
				(performance.now() - performanceStartTimeRef.current) / 1000;
			return playbackTimeAtStartRef.current + elapsed;
		}

		return playbackTimeAtStartRef.current;
	}, []);

	// 开始视频帧迭代器
	const startVideoIterator = useCallback(async () => {
		if (!videoSinkRef.current) {
			return;
		}

		// 如果正在 seek，等待当前操作完成
		if (isSeekingRef.current) {
			return;
		}

		isSeekingRef.current = true;
		asyncIdRef.current++;
		await videoFrameIteratorRef.current?.return();

		const currentAsyncId = asyncIdRef.current;

		// 检查 videoSinkRef 是否仍然存在（可能在异步操作期间被清理）
		if (!videoSinkRef.current) {
			isSeekingRef.current = false;
			return;
		}

		videoFrameIteratorRef.current = videoSinkRef.current.canvases(
			playbackTimeAtStartRef.current,
		);

		// 检查迭代器是否成功创建
		if (!videoFrameIteratorRef.current) {
			isSeekingRef.current = false;
			return;
		}

		// 获取第一帧
		try {
			const firstFrame =
				(await videoFrameIteratorRef.current.next()).value ?? null;

			if (
				currentAsyncId !== asyncIdRef.current ||
				!videoFrameIteratorRef.current
			) {
				isSeekingRef.current = false;
				return; // 已被新的异步操作替换或迭代器被清理
			}

			const secondFrame =
				(await videoFrameIteratorRef.current.next()).value ?? null;

			if (
				currentAsyncId !== asyncIdRef.current ||
				!videoFrameIteratorRef.current
			) {
				isSeekingRef.current = false;
				return; // 已被新的异步操作替换或迭代器被清理
			}

			nextFrameRef.current = secondFrame;

			if (firstFrame) {
				const canvas = firstFrame.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					updateFrame(canvas);
				}
			}
		} catch (err) {
			console.warn("获取视频帧失败:", err);
		} finally {
			isSeekingRef.current = false;
		}
	}, [updateFrame]);

	// 播放视频
	const play = useCallback(async () => {
		if (!videoSinkRef.current && !audioSinkRef.current) {
			return;
		}

		if (isPlayingRef.current) {
			return;
		}

		if (audioContextRef.current?.state !== "running") {
			await audioContextRef.current?.resume();
		}

		setIsPlaying(true);
		isPlayingRef.current = true;
		playbackTimeAtStartRef.current = getPlaybackTime();

		// 如果有音频上下文，使用它来跟踪时间
		if (audioContextRef.current) {
			audioContextStartTimeRef.current = audioContextRef.current.currentTime;
			performanceStartTimeRef.current = null;
		} else {
			// 如果没有音频上下文，使用 performance.now() 来跟踪时间
			performanceStartTimeRef.current = performance.now();
			audioContextStartTimeRef.current = null;
		}

		// 播放音频（修复爆音问题）
		if (
			audioSinkRef.current &&
			audioContextRef.current &&
			gainNodeRef.current &&
			!isAudioPlayingRef.current
		) {
			// 注意：AudioBufferSink 的 API 可能因版本而异
			// 这里暂时简化处理，音频播放功能可以后续完善
			try {
				// 尝试使用可能的 API 方法
				const audioBuffersMethod =
					(audioSinkRef.current as any).audioBuffers ||
					(audioSinkRef.current as any).buffers ||
					(audioSinkRef.current as any).samples;

				if (audioBuffersMethod && typeof audioBuffersMethod === "function") {
					const audioBuffers = audioBuffersMethod.call(
						audioSinkRef.current,
						playbackTimeAtStartRef.current,
					);
					if (
						audioBuffers &&
						typeof audioBuffers[Symbol.asyncIterator] === "function"
					) {
						isAudioPlayingRef.current = true;

						// 先设置音量为 0，然后淡入以避免爆音
						const targetGain = 0.7;
						gainNodeRef.current.gain.setValueAtTime(
							0,
							audioContextRef.current.currentTime,
						);
						gainNodeRef.current.gain.linearRampToValueAtTime(
							targetGain,
							audioContextRef.current.currentTime + 0.1, // 100ms 淡入
						);

						const playAudio = async () => {
							try {
								let bufferStartTime = audioContextRef.current!.currentTime;

								for await (const wrappedBuffer of audioBuffers) {
									if (
										!isPlayingRef.current ||
										audioContextRef.current?.state !== "running" ||
										!isAudioPlayingRef.current
									) {
										break;
									}

									const buffer = wrappedBuffer.buffer || wrappedBuffer;
									if (!buffer) {
										continue;
									}

									const source = audioContextRef.current.createBufferSource();
									source.buffer = buffer;
									source.connect(gainNodeRef.current!);

									// 计算正确的开始时间，确保音频与视频同步
									const bufferDuration = buffer.duration;
									source.start(bufferStartTime);

									// 跟踪音频源，以便在暂停时停止
									audioSourcesRef.current.push(source);

									// 当音频源播放结束时，从列表中移除
									source.onended = () => {
										const index = audioSourcesRef.current.indexOf(source);
										if (index > -1) {
											audioSourcesRef.current.splice(index, 1);
										}
									};

									bufferStartTime += bufferDuration;
								}
							} catch (err) {
								console.warn("音频播放错误:", err);
								isAudioPlayingRef.current = false;
							}
						};
						void playAudio();
					}
				}
			} catch (err) {
				console.warn("音频播放初始化失败:", err);
				isAudioPlayingRef.current = false;
			}
		}

		// 渲染视频帧
		const renderFrame = async () => {
			if (!isPlayingRef.current) {
				return;
			}

			const currentAsyncId = asyncIdRef.current;
			const targetTime = getPlaybackTime();

			if (!videoFrameIteratorRef.current) {
				return;
			}

			// 找到应该显示的帧：时间戳 <= targetTime 的最后一帧
			let frameToShow: WrappedCanvas | null = null;

			while (
				nextFrameRef.current &&
				nextFrameRef.current.timestamp <= targetTime &&
				videoFrameIteratorRef.current
			) {
				frameToShow = nextFrameRef.current;

				// 在调用 next() 前再次检查迭代器是否存在
				if (!videoFrameIteratorRef.current) {
					break;
				}

				try {
					// 获取下一帧
					const next = await videoFrameIteratorRef.current.next();
					nextFrameRef.current = next.value ?? null;
				} catch (err) {
					console.warn("获取下一帧失败:", err);
					nextFrameRef.current = null;
					break;
				}

				// 检查是否被新的异步操作替换
				if (currentAsyncId !== asyncIdRef.current) {
					return;
				}

				// 再次检查迭代器是否仍然存在
				if (!videoFrameIteratorRef.current) {
					break;
				}

				// 如果没有更多帧了，跳出循环
				if (!nextFrameRef.current) {
					break;
				}
			}

			// 显示找到的帧
			if (frameToShow) {
				const canvas = frameToShow.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					updateFrame(canvas);
				}
			} else if (nextFrameRef.current) {
				// 如果没有找到合适的帧，但还有下一帧，显示它（可能是第一帧）
				const canvas = nextFrameRef.current.canvas;
				if (
					canvas instanceof HTMLCanvasElement ||
					canvas instanceof OffscreenCanvas
				) {
					updateFrame(canvas);
				}
			}

			if (currentAsyncId !== asyncIdRef.current) {
				return;
			}

			// 再次检查迭代器是否仍然存在
			if (!videoFrameIteratorRef.current) {
				return;
			}

			setCurrentTime(targetTime);

			// 继续渲染或结束
			if (targetTime < duration && videoFrameIteratorRef.current) {
				animationFrameRef.current = requestAnimationFrame(() => {
					void renderFrame();
				});
			} else {
				setIsPlaying(false);
				isPlayingRef.current = false;
				setCurrentTime(duration);
			}
		};

		void renderFrame();
	}, [duration, getPlaybackTime, updateFrame]);

	// 初始化媒体播放器
	const initMediaPlayer = useCallback(
		async (resource: File | string) => {
			// 立即增加 asyncId，这样旧的 renderFrame 就能检测到已被替换
			asyncIdRef.current++;
			const currentInitId = asyncIdRef.current;

			try {
				setIsLoading(true);
				setError(null);
				setIsPlaying(false);
				isPlayingRef.current = false;

				// 清理之前的资源 - 先停止播放和动画
				if (animationFrameRef.current !== null) {
					cancelAnimationFrame(animationFrameRef.current);
					animationFrameRef.current = null;
				}

				// 检查是否已被新的初始化替换
				if (currentInitId !== asyncIdRef.current) {
					setIsLoading(false);
					return;
				}

				// 停止所有正在播放的音频源
				if (audioSourcesRef.current.length > 0) {
					audioSourcesRef.current.forEach((source) => {
						try {
							source.stop();
						} catch (err) {
							// 音频源可能已经停止，忽略错误
						}
					});
					audioSourcesRef.current = [];
				}
				isAudioPlayingRef.current = false;

				// 关闭旧的 AudioContext（如果存在且未关闭）
				if (audioContextRef.current) {
					try {
						if (audioContextRef.current.state !== "closed") {
							await audioContextRef.current.close();
						}
					} catch (err) {
						console.warn("关闭 AudioContext 时出错:", err);
					}
					audioContextRef.current = null;
					gainNodeRef.current = null;
				}

				// 清理旧的视频和音频 Sink
				videoSinkRef.current = null;
				audioSinkRef.current = null;
				inputRef.current = null;
				nextFrameRef.current = null;

				// 清理旧的视频帧迭代器
				try {
					await videoFrameIteratorRef.current?.return();
				} catch (err) {
					console.warn("清理视频帧迭代器时出错:", err);
				}
				videoFrameIteratorRef.current = null;

				// 检查是否已被新的初始化替换
				if (currentInitId !== asyncIdRef.current) {
					setIsLoading(false);
					return;
				}

				// 重置状态
				setCurrentFrameImage(null);
				setCurrentTime(0);
				playbackTimeAtStartRef.current = 0;
				audioContextStartTimeRef.current = null;
				performanceStartTimeRef.current = null;

				// 创建 Input
				const source =
					resource instanceof File
						? new BlobSource(resource)
						: new UrlSource(resource);
				const input = new Input({
					source,
					formats: ALL_FORMATS,
				});
				inputRef.current = input;

				// 计算时长
				const totalDuration = await input.computeDuration();
				setDuration(totalDuration);
				playbackTimeAtStartRef.current = 0;

				// 获取音视频轨道
				let videoTrack = await input.getPrimaryVideoTrack();
				let audioTrack = await input.getPrimaryAudioTrack();

				let problemMessage = "";

				if (videoTrack) {
					if (videoTrack.codec === null) {
						problemMessage += "不支持的视频编解码器。";
						videoTrack = null;
					} else if (!(await videoTrack.canDecode())) {
						problemMessage += "无法解码视频轨道。";
						videoTrack = null;
					}
				}

				if (audioTrack) {
					if (audioTrack.codec === null) {
						problemMessage += "不支持的音频编解码器。";
						audioTrack = null;
					} else if (!(await audioTrack.canDecode())) {
						problemMessage += "无法解码音频轨道。";
						audioTrack = null;
					}
				}

				if (!videoTrack && !audioTrack) {
					throw new Error(problemMessage || "未找到音视频轨道。");
				}

				if (problemMessage) {
					console.warn(problemMessage);
				}

				// 创建音频上下文
				if (audioTrack) {
					const AudioContext =
						window.AudioContext || (window as any).webkitAudioContext;
					audioContextRef.current = new AudioContext({
						sampleRate: audioTrack.sampleRate,
					});
					gainNodeRef.current = audioContextRef.current.createGain();
					gainNodeRef.current.connect(audioContextRef.current.destination);
					gainNodeRef.current.gain.value = 0.7;
				}

				// 创建视频和音频 Sink
				if (videoTrack) {
					const videoCanBeTransparent = await videoTrack.canBeTransparent();
					videoSinkRef.current = new CanvasSink(videoTrack, {
						poolSize: 2,
						fit: "contain",
						alpha: videoCanBeTransparent,
					});
				}

				if (audioTrack) {
					audioSinkRef.current = new AudioBufferSink(audioTrack);
				}

				// 检查是否已被新的初始化替换
				if (currentInitId !== asyncIdRef.current) {
					setIsLoading(false);
					return;
				}

				// 初始化视频帧迭代器
				// 注意：startVideoIterator 会递增 asyncIdRef.current，所以需要记录期望的增量
				const expectedAsyncIdAfterStart = asyncIdRef.current + 1;
				await startVideoIterator();

				// 检查是否已被新的初始化替换（在 startVideoIterator 执行期间）
				// 如果 asyncIdRef.current 不是期望的值，说明在 startVideoIterator 执行期间
				// 有新的初始化开始了（会再次递增 asyncIdRef.current）
				if (asyncIdRef.current !== expectedAsyncIdAfterStart) {
					setIsLoading(false);
					return;
				}

				setIsLoading(false);

				// 如果没有视频轨道，确保至少显示一个错误提示
				if (!videoSinkRef.current) {
					console.warn("没有可用的视频轨道");
				}

				// 检查是否已被新的初始化替换
				if (asyncIdRef.current !== expectedAsyncIdAfterStart) {
					setIsLoading(false);
					return;
				}

				if (autoPlay && audioContextRef.current?.state !== "running") {
					await play();
				} else if (autoPlay) {
					// 如果音频上下文未运行，尝试恢复它
					await audioContextRef.current?.resume();
					if (audioContextRef.current?.state === "running") {
						await play();
					}
				}
			} catch (err) {
				// 只有在当前初始化仍然有效时才设置错误
				if (currentInitId === asyncIdRef.current) {
					console.error("初始化媒体播放器失败:", err);
					setError(err instanceof Error ? err.message : "未知错误");
					setIsLoading(false);
				}
			}
		},
		[autoPlay, startVideoIterator, play],
	);

	// 暂停视频
	const pause = useCallback(() => {
		setIsPlaying(false);
		isPlayingRef.current = false;
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}

		// 停止所有正在播放的音频源
		if (audioSourcesRef.current.length > 0) {
			// 停止所有音频源
			audioSourcesRef.current.forEach((source) => {
				try {
					source.stop();
				} catch (err) {
					// 音频源可能已经停止，忽略错误
				}
			});
			audioSourcesRef.current = [];
		}

		isAudioPlayingRef.current = false;

		// 更新播放时间，以便下次播放时从正确的位置开始
		playbackTimeAtStartRef.current = getPlaybackTime();
		audioContextStartTimeRef.current = null;
		performanceStartTimeRef.current = null;
	}, [getPlaybackTime]);

	// 跳转到指定时间
	const seekToTime = useCallback(
		async (seconds: number) => {
			const wasPlaying = isPlayingRef.current;
			if (wasPlaying) {
				pause();
			}

			playbackTimeAtStartRef.current = Math.max(0, Math.min(seconds, duration));
			setCurrentTime(playbackTimeAtStartRef.current);

			await startVideoIterator();

			// if (wasPlaying && playbackTimeAtStartRef.current < duration) {
			//   await play();
			// }
		},
		[duration, pause, startVideoIterator],
	);

	// 处理鼠标悬停，根据横向百分比 seek
	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!canvasContainerRef.current || !duration) {
				return;
			}

			const rect = canvasContainerRef.current.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const percentage = Math.max(0, Math.min(1, x / rect.width));
			const targetTime = percentage * duration;

			// 保存待处理的 seek 时间
			pendingSeekTimeRef.current = targetTime;

			// 如果已经有待处理的 RAF，取消它
			if (mouseMoveRafRef.current !== null) {
				cancelAnimationFrame(mouseMoveRafRef.current);
			}

			// 使用 requestAnimationFrame 节流，确保跟手操作流畅
			mouseMoveRafRef.current = requestAnimationFrame(() => {
				mouseMoveRafRef.current = null;
				const timeToSeek = pendingSeekTimeRef.current;
				if (timeToSeek !== null) {
					pendingSeekTimeRef.current = null;
					void seekToTime(timeToSeek);
				}
			});
		},
		[duration, seekToTime],
	);

	// 处理鼠标离开
	const handleMouseLeave = useCallback(() => {
		if (hoverSeekTimeoutRef.current !== null) {
			clearTimeout(hoverSeekTimeoutRef.current);
			hoverSeekTimeoutRef.current = null;
		}
	}, []);

	// 初始化 - 只在 props 变化时加载（首次挂载或 props 变化）
	useEffect(() => {
		const source = file || url;
		if (source) {
			// 首次挂载时，或者 props 真正变化时，才更新视频源
			setCurrentVideoSource((prev) => {
				// 如果 prev 是 File 对象，说明是用户通过文件选择器选择的
				// 只有在 props 明确提供了新的 file 时，才覆盖用户选择
				if (prev instanceof File && !file) {
					// 用户选择了文件，且当前没有 file prop，保持用户选择
					return prev;
				}
				// 首次初始化，或者 source 和 prev 不同
				if (!isInitializedRef.current || prev !== source) {
					isInitializedRef.current = true;
					return source;
				}
				return prev;
			});
		}
	}, [file, url]);

	// 当视频源变化时，加载视频
	useEffect(() => {
		if (!currentVideoSource) {
			return;
		}

		let isCancelled = false;

		const loadVideo = async () => {
			await initMediaPlayer(currentVideoSource);
			if (isCancelled) {
				return;
			}
		};

		void loadVideo();

		return () => {
			isCancelled = true;
			pause();
			setIsLoading(false);
			void videoFrameIteratorRef.current?.return();
			if (audioContextRef.current) {
				try {
					if (audioContextRef.current.state !== "closed") {
						void audioContextRef.current.close();
					}
				} catch (err) {
					console.warn("清理 AudioContext 时出错:", err);
				}
				audioContextRef.current = null;
				gainNodeRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentVideoSource, initMediaPlayer, pause]);

	// 清理
	useEffect(() => {
		return () => {
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (hoverSeekTimeoutRef.current !== null) {
				clearTimeout(hoverSeekTimeoutRef.current);
			}
			if (mouseMoveRafRef.current !== null) {
				cancelAnimationFrame(mouseMoveRafRef.current);
			}
		};
	}, []);

	return (
		<div className="canvas-container">
			<h2 style={{ display: "flex", gap: "4px" }}>
				Skia Video Player
				{error && <div style={{ color: "red" }}>错误: {error}</div>}
				{isLoading && <div>加载中...</div>}
			</h2>
			<div style={{ marginBottom: "10px" }}>
				<button type="button" onClick={() => (isPlaying ? pause() : play())}>
					{isPlaying ? "暂停" : "播放"}
				</button>
				<span style={{ margin: "0 10px" }}>
					{Math.floor(currentTime)}s / {Math.floor(duration)}s
				</span>
				<input
					type="range"
					min={0}
					max={duration || 0}
					step={0.001}
					value={currentTime}
					onChange={(e) => seekToTime(Number(e.target.value))}
					style={{ width: "300px" }}
				/>
			</div>
			<div
				ref={canvasContainerRef}
				onMouseMove={handleMouseMove}
				onMouseLeave={handleMouseLeave}
				style={{ display: "inline-block", cursor: "pointer" }}
			>
				<Canvas style={{ width, height }}>
					<Group>
						{/* <Fill> */}
						{currentFrameImage && (
							<Image
								image={currentFrameImage}
								rect={rect(0, 0, width, height)}
								fit="contain"
							/>
						)}
						{/* </Fill> */}
					</Group>
				</Canvas>
			</div>
			<div style={{ marginTop: "10px" }}>
				<input
					type="file"
					accept="video/*,audio/*"
					onChange={(e) => {
						const selectedFile = e.target.files?.[0];
						if (selectedFile) {
							// 用户主动选择文件，直接更新视频源
							setCurrentVideoSource(selectedFile);
							// 重置 input 值，允许选择同一个文件
							e.target.value = "";
						}
					}}
				/>
			</div>
		</div>
	);
}
