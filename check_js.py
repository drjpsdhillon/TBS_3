import re
with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

m = re.search(r"<script>([\s\S]*?)</script>", html)
if m:
    with open("temp_script.js", "w", encoding="utf-8") as f_out:
        f_out.write(m.group(1))
    print("Wrote temp_script.js, length:", len(m.group(1)))
