import re

with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

m = re.search(r"<script>([\s\S]*?)</script>", html)
if not m:
    print("Error: <script> not found")
    exit(1)

js_code = m.group(1)
print(f"JS code found, length = {len(js_code)} characters")

# Check balanced pairs
stack = []
pairs = {')': '(', '}': '{', ']': '['}

i = 0
n = len(js_code)
line_num = 1
col_num = 1

while i < n:
    ch = js_code[i]
    if ch == '\n':
        line_num += 1
        col_num = 1
        i += 1
        continue
    
    # Check string literals
    if ch in ('"', "'", '`'):
        quote = ch
        start_line = line_num
        i += 1
        col_num += 1
        while i < n:
            if js_code[i] == '\n':
                line_num += 1
                col_num = 1
            else:
                col_num += 1
            if js_code[i] == '\\':
                i += 2 # skip escape
                col_num += 1
                continue
            if quote == '`' and js_code[i:i+2] == '${':
                # template literal expression
                stack.append(('`', line_num, col_num))
                i += 2
                col_num += 1
                break
            if js_code[i] == quote:
                i += 1
                break
            i += 1
        continue
    
    # Check comments
    if ch == '/' and i + 1 < n:
        if js_code[i+1] == '/':
            # line comment
            i += 2
            while i < n and js_code[i] != '\n':
                i += 1
            continue
        elif js_code[i+1] == '*':
            # block comment
            i += 2
            while i + 1 < n and not (js_code[i] == '*' and js_code[i+1] == '/'):
                if js_code[i] == '\n':
                    line_num += 1
                    col_num = 1
                else:
                    col_num += 1
                i += 1
            i += 2
            continue
    
    if ch in '({[':
        stack.append((ch, line_num, col_num, i))
    elif ch in ')}]':
        if not stack:
            print(f"ERROR: Unmatched closing '{ch}' at line {line_num}:{col_num}")
            print("Context:", js_code[max(0, i-40):min(n, i+40)])
            break
        top, top_l, top_c, top_i = stack.pop()
        if top == '`' and ch == '}':
            # resume template literal
            quote = '`'
            i += 1
            while i < n:
                if js_code[i] == '\n':
                    line_num += 1
                    col_num = 1
                else:
                    col_num += 1
                if js_code[i] == '\\':
                    i += 2
                    col_num += 1
                    continue
                if js_code[i:i+2] == '${':
                    stack.append(('`', line_num, col_num))
                    i += 2
                    col_num += 1
                    break
                if js_code[i] == '`':
                    i += 1
                    break
                i += 1
            continue
        if pairs[ch] != top:
            print(f"ERROR: Mismatched '{ch}' at line {line_num}:{col_num} (expected closing for '{top}' from line {top_l}:{top_c})")
            print("Context around error:", repr(js_code[max(0, i-60):min(n, i+60)]))
            print("Context around open:", repr(js_code[max(0, top_i-60):min(n, top_i+60)]))
            break
    i += 1
    col_num += 1

if stack:
    print(f"Unclosed items remaining: {len(stack)}")
    for item in stack[-5:]:
        print(f"  Unclosed '{item[0]}' at line {item[1]}:{item[2]}")
else:
    print("All brackets, parentheses, and braces balanced cleanly!")
