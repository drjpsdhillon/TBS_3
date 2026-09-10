import subprocess
import os

# Test if we can parse temp_script.js with Python or Windows cscript / mshta / powershell
# Let's test with powershell using Jurassic or JScript or Edge headless
cmd = [
    "powershell",
    "-Command",
    """
    Add-Type -AssemblyName System.Web.Extensions
    # Or let's use an HTML document in COM or Edge WebView
    $sc = New-Object -ComObject ScriptControl
    $sc.Language = "JScript"
    """
]
print("Running check...")
