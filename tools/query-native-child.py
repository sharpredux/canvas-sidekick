#!/usr/bin/env python3
"""Read the real X11 child window's geometry and visibility for host acceptance."""
import ctypes as C
import json
import sys
x=C.CDLL('libX11.so.6')
class Attributes(C.Structure):
    _fields_=[('x',C.c_int),('y',C.c_int),('width',C.c_int),('height',C.c_int),('border',C.c_int),('depth',C.c_int),('visual',C.c_void_p),('root',C.c_ulong),('kind',C.c_int),('bit_gravity',C.c_int),('win_gravity',C.c_int),('backing_store',C.c_int),('backing_planes',C.c_ulong),('backing_pixel',C.c_ulong),('save_under',C.c_int),('colormap',C.c_ulong),('map_installed',C.c_int),('map_state',C.c_int),('all_events',C.c_long),('your_events',C.c_long),('no_propagate',C.c_long),('override',C.c_int),('screen',C.c_void_p)]
x.XOpenDisplay.argtypes=[C.c_char_p];x.XOpenDisplay.restype=C.c_void_p
x.XQueryTree.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(C.c_ulong),C.POINTER(C.c_ulong),C.POINTER(C.POINTER(C.c_ulong)),C.POINTER(C.c_uint)]
x.XFetchName.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(C.c_void_p)]
x.XGetWindowAttributes.argtypes=[C.c_void_p,C.c_ulong,C.POINTER(Attributes)]
x.XFree.argtypes=[C.c_void_p];x.XCloseDisplay.argtypes=[C.c_void_p]
display=x.XOpenDisplay(None);assert display
def children(window,depth=0):
    root=C.c_ulong();parent=C.c_ulong();items=C.POINTER(C.c_ulong)();count=C.c_uint()
    assert x.XQueryTree(display,window,C.byref(root),C.byref(parent),C.byref(items),C.byref(count))
    windows=list(items[:count.value]);x.XFree(items)
    for child in windows:
        name=C.c_void_p();x.XFetchName(display,child,C.byref(name))
        label=C.string_at(name).decode(errors='replace') if name.value else ''
        if name.value:x.XFree(name)
        if label=='Canvas Sidekick':
            attributes=Attributes();assert x.XGetWindowAttributes(display,child,C.byref(attributes))
            return {'xid':child,'parent':window,'x':attributes.x,'y':attributes.y,'width':attributes.width,'height':attributes.height,'visible':attributes.map_state==2}
        if depth<4:
            found=children(child,depth+1)
            if found:return found
    return None
try:print(json.dumps(children(int(sys.argv[1]))))
finally:x.XCloseDisplay(display)
