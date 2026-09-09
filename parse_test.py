import esprima
try:
    with open("temp_script.js", "r", encoding="utf-8") as f:
        code = f.read()
    esprima.parseScript(code)
    print("VALID JAVASCRIPT SYNTAX!")
except Exception as e:
    print("PARSE ERROR:", e)
