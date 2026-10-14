cmake_minimum_required(VERSION 3.22.1)
project(manadj_audio LANGUAGES CXX)
find_package(oboe REQUIRED CONFIG)
add_library(manadj_audio SHARED Engine.cpp Jni.cpp)
target_compile_features(manadj_audio PRIVATE cxx_std_17)
target_include_directories(manadj_audio PRIVATE third_party)
# Realtime DSP (EQ, filter, Beat FX, time-stretch) is optimized in every variant, debug included.
target_compile_options(manadj_audio PRIVATE -O3)
target_link_libraries(manadj_audio PRIVATE oboe::oboe log)
