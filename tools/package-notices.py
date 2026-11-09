#!/usr/bin/env python3
"""Collect font and cached dependency licenses for either packaging platform."""
import importlib.util
from pathlib import Path
import sys

spec=importlib.util.spec_from_file_location('sidekick_packaging',Path(__file__).with_name('package-linux.py'))
packaging=importlib.util.module_from_spec(spec)
spec.loader.exec_module(packaging)
packaging.notices(Path(sys.argv[1]))
