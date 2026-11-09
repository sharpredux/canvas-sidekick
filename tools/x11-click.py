#!/usr/bin/env python3
"""Send a real click to a local test window, including Chromium's native popup."""
import ctypes as C
import sys
x=C.CDLL('libX11.so.6');xt=C.CDLL('libXtst.so.6')
x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=C.c_void_p
x.XDefaultRootWindow.argtypes=[C.c_void_p];x.XDefaultRootWindow.restype=C.c_ulong
x.XTranslateCoordinates.argtypes=[C.c_void_p,C.c_ulong,C.c_ulong,C.c_int,C.c_int,C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_ulong)]
x.XFlush.argtypes=[C.c_void_p];x.XCloseDisplay.argtypes=[C.c_void_p]
xt.XTestFakeMotionEvent.argtypes=[C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_ulong]
xt.XTestFakeButtonEvent.argtypes=[C.c_void_p,C.c_uint,C.c_int,C.c_ulong]
d=x.XOpenDisplay(None);assert d
try:
    rx=C.c_int();ry=C.c_int();child=C.c_ulong()
    assert x.XTranslateCoordinates(d,int(sys.argv[1]),x.XDefaultRootWindow(d),int(float(sys.argv[2])),int(float(sys.argv[3])),C.byref(rx),C.byref(ry),C.byref(child))
    xt.XTestFakeMotionEvent(d,-1,rx.value,ry.value,0)
    xt.XTestFakeButtonEvent(d,1,1,0);xt.XTestFakeButtonEvent(d,1,0,0);x.XFlush(d)
finally:x.XCloseDisplay(d)
