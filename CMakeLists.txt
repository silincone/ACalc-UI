cmake_minimum_required(VERSION 3.20)
project(ACalc CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(ACalc src/main.cpp)
target_include_directories(ACalc PRIVATE src)

if(EMSCRIPTEN)
    target_link_options(ACalc PRIVATE
        --bind
        -sMODULARIZE=1
        -sEXPORT_NAME="ACalcModule"
        -sEXPORT_ES6=0
    )
    set_target_properties(ACalc PROPERTIES OUTPUT_NAME "acalc" SUFFIX ".js")
endif()