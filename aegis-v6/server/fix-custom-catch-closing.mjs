/**
 * fix-custom-catch-closing.mjs
 *
 * For routes that:
 *   1. Are wrapped with asyncRoute( 
 *   2. Have a custom } catch (err: any) { handler
 *   3. End with }) instead of }))
 *
 * Transforms the closing from \n}) to \n})) when the preceding
 * catch was NOT the standard next(err) pattern.
 *
 * Only transforms } catch (err: any) { patterns, then looks for the
 * \n}) that closes the route and changes it to \n}))
 */
import { readFileSync, writeFileSync } from 'fs'

for (const filePath of process.argv.slice(2)) {
  const raw = readFileSync(filePath, 'utf8')
  const wasCRLF = raw.includes('\r\n')
  let src = raw.replace(/\r\n/g, '\n')

  // Pattern: custom catch followed by route closing
  // } catch (err: any) {
  //   ... custom error response ...
  // }
  // })
  // The }) needs to become }))
  
  // We'll find the specific pattern: lines ending in `}\n})` that come AFTER
  // a `} catch (err:` or `} catch (err :` pattern somewhere above.
  // Simpler: just find `\n})` that closes after a `} catch (err:` in the same route.
  
  // Most reliable: find blocks that look like:
  //   } catch (err: any) {
  //     BODY
  //   }
  // })
  // And change the last }) to }))
  
  // The pattern: `\n  }\n})` (closing catch body + route close) where
  // the catch was custom (not next(err)).
  // We specifically know these come after `} catch (err: any)` or `} catch (err :`.
  
  src = src.replace(
    /(\}\s*catch\s*\(err\s*:\s*\w+\)[^}]*\})\s*\n\}\)/gms,
    (match, catchBlock) => {
      return catchBlock + '\n})'
    }
  )
  
  // Simpler direct approach: normalize })  after custom catch to }))
  // Find: end of a } catch (err: any) { ... } block followed by \n})
  // and change }) to }))
  
  // Split into lines and fix each } catch (err: route
  const lines = src.split('\n')
  let result = []
  let i = 0
  let fixed = 0
  
  while (i < lines.length) {
    const line = lines[i]
    
    // Look for `  } catch (err:` lines (custom catch, not standard)
    if (/^\s+\} catch \(err[^)]*\) \{/.test(line) && !line.includes('next(err)')) {
      result.push(line)
      i++
      // Scan forward to the end of this catch block (find closing `  }`)
      // then check if next line is `})`
      let depth = 1
      while (i < lines.length && depth > 0) {
        const cl = lines[i]
        for (const ch of cl) {
          if (ch === '{') depth++
          if (ch === '}') depth--
        }
        result.push(cl)
        i++
      }
      // After the catch body closes (depth=0), check next line
      if (i < lines.length && lines[i].trim() === '})') {
        result.push('}))') 
        fixed++
        i++
      }
      continue
    }
    
    result.push(line)
    i++
  }
  
  src = result.join('\n')
  
  let out = src
  if (wasCRLF) out = out.replace(/\n/g, '\r\n')
  writeFileSync(filePath, out, 'utf8')
  console.log(`${filePath}: fixed ${fixed} custom-catch route closings`)
}
