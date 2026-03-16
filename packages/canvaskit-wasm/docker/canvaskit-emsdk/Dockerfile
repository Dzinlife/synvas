ARG EMSDK_BASE_IMAGE=emscripten/emsdk:3.1.26
FROM ${EMSDK_BASE_IMAGE}

RUN apt-get update && apt-get install -y \
	libfreetype6-dev \
	&& rm -rf /var/lib/apt/lists/*
