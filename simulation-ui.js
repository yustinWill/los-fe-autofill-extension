/**
 * The simulation panel's DOM — built in JS rather than written into popup.html
 * because almost all of it is data-driven (six collateral branches, eleven
 * tables, three pill groups), and a hand-written copy would drift from
 * `simulation.js` the first time a branch is added.
 *
 * Renders nothing until `mount()` is called, which popup.js only does on the
 * credit-application create route.
 */
window.SIMUI = (() => {
  const el = (tag, attrs = {}, kids = []) => {
    const node = document.createElement(tag)

    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v
      else if (k === 'text') node.textContent = v
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
      else node.setAttribute(k, v)
    })

    ;(Array.isArray(kids) ? kids : [kids]).forEach(kid => kid && node.appendChild(kid))

    return node
  }

  let root = null
  let onChange = () => {}

  /**
   * 🔴 The derived text, refreshed IN PLACE — never by re-rendering.
   *
   * `commit()` rebuilds the whole panel (`root.textContent = ''`), which
   * destroys and recreates the very input being typed into: focus is lost on
   * EVERY keystroke, so a name has to be typed one character per click. The
   * name boxes therefore save + refresh instead of committing.
   *
   * Only two things derive from those names — the project-name preview and each
   * collateral row's placeholder — so patching them directly is both cheaper
   * and the only version that keeps the caret.
   */
  const refreshDerived = () => {
    if (!root) return

    const preview = root.querySelector('.sim-preview-input')

    if (preview && !SIM.state.projectOverride) {
      preview.value = SIM.projectName()
      preview.title = preview.value
    }

    root.querySelectorAll('.sim-collateral').forEach((row, index) => {
      const item = SIM.state.collaterals[index]
      const name = row.querySelector('.sim-name')

      if (!item || !name) return

      name.placeholder = SIM.collateralName({ ...item, name: null })
      name.title = name.placeholder
    })
  }

  /** One pill group — the scenario dimensions. A radio would need three names
   *  and a legend to say the same thing in more space. */
  const pills = (group, options, current) =>
    el(
      'div',
      { class: 'sim-pills' },
      options.map(option =>
        el('button', {
          class: `sim-pill${option.v === current ? ' is-on' : ''}`,
          type: 'button',
          text: option.label,
          'data-v': option.v,
          onclick: () => {
            SIM.state[group] = option.v
            commit()
          }
        })
      )
    )

  const labelled = (text, control) => el('div', { class: 'sim-row' }, [el('span', { class: 'sim-row-label', text }), control])

  /** A text field that writes straight into state on input. `placeholder`
   *  carries the fallback the name generator will use, so an empty box is not a
   *  mystery. */
  const textField = (value, placeholder, onInput) => {
    const input = el('input', { class: 'sim-input', type: 'text', placeholder })

    input.value = value || ''
    input.addEventListener('input', () => onInput(input.value.trim()))

    return input
  }

  const stepper = table => {
    const wrap = el('div', { class: 'sim-step' })
    const out = el('input', { class: 'sim-num', type: 'number', min: '0', max: String(table.max) })

    out.value = String(SIM.state.rows[table.key] ?? table.def)
    out.addEventListener('change', () => {
      const n = Math.max(0, Math.min(table.max, Number(out.value) || 0))

      out.value = String(n)
      SIM.state.rows[table.key] = n
      SIM.save()
    })

    wrap.appendChild(out)

    return wrap
  }

  const collateralRow = (item, index) => {
    const select = el('select', { class: 'sim-select' })

    SIM.COLLATERAL_TYPES.forEach(type => {
      const option = el('option', { value: type.key, text: type.label })

      if (type.key === item.type) option.selected = true
      select.appendChild(option)
    })

    select.addEventListener('change', () => {
      item.type = select.value

      /* A derived name must follow the type. An OVERRIDDEN one must not — the
         user typed it about this row, not about its branch. */
      if (!item.name) commit()
      else SIM.save()
    })

    const name = el('input', { class: 'sim-input sim-name', type: 'text' })

    name.value = item.name || ''
    name.placeholder = SIM.collateralName({ ...item, name: null })
    name.title = name.placeholder
    name.addEventListener('input', () => {
      item.name = name.value.trim() || null
      name.classList.toggle('is-custom', Boolean(item.name))
      SIM.save()
    })

    if (item.name) name.classList.add('is-custom')

    const remove = el('button', {
      class: 'sim-icon',
      type: 'button',
      title: 'Hapus agunan',
      'aria-label': 'Hapus agunan',
      text: '✕',
      onclick: () => {
        SIM.state.collaterals.splice(index, 1)
        commit()
      }
    })

    return el('div', { class: 'sim-collateral' }, [select, name, remove])
  }

  const render = () => {
    if (!root) return
    root.textContent = ''

    // ── Scenario ──────────────────────────────────────────────────────────
    root.appendChild(el('div', { class: 'sim-legend', text: 'Skenario' }))
    root.appendChild(labelled('Jenis', pills('jenis', SIM.SCENARIO.jenis, SIM.state.jenis)))
    root.appendChild(labelled('Debitur', pills('debitur', SIM.SCENARIO.debitur, SIM.state.debitur)))
    root.appendChild(labelled('Sifat', pills('sifat', SIM.SCENARIO.sifat, SIM.state.sifat)))

    /* save + refresh, NOT commit — see `refreshDerived`. A re-render here costs
       the caret on every keystroke. */
    root.appendChild(
      labelled(
        'Nama Anda',
        textField(SIM.state.userName, 'Yusti', v => {
          SIM.state.userName = v
          SIM.save()
          refreshDerived()
        })
      )
    )

    /* Editable, and blank is legitimate: the debtor is picked DURING the fill,
       so at popup time there may be no name yet. The collateral placeholder
       shows `{debitur}` in that case rather than a hole. */
    root.appendChild(
      labelled(
        'Nama debitur',
        textField(SIM.state.debtorName, 'diisi saat pengisian', v => {
          SIM.state.debtorName = v
          SIM.save()
          refreshDerived()
        })
      )
    )

    // ── The derived name ──────────────────────────────────────────────────
    const preview = el('div', { class: 'sim-preview' })
    const previewText = el('input', { class: 'sim-preview-input', type: 'text' })

    previewText.value = SIM.projectName()
    previewText.title = previewText.value
    previewText.addEventListener('input', () => {
      const typed = previewText.value.trim()

      /* Typing an override pins it; clearing the box hands the name back to the
         pills rather than leaving an empty project name. */
      SIM.state.projectOverride = typed || null
      SIM.save()
      previewText.classList.toggle('is-custom', Boolean(SIM.state.projectOverride))
    })

    if (SIM.state.projectOverride) previewText.classList.add('is-custom')

    preview.appendChild(el('span', { class: 'sim-preview-label', text: 'Nama proyek' }))
    preview.appendChild(previewText)
    root.appendChild(preview)

    // ── Rows per table ────────────────────────────────────────────────────
    root.appendChild(el('div', { class: 'sim-legend', text: 'Jumlah baris per tabel' }))

    const grid = el('div', { class: 'sim-grid' })
    const more = el('div', { class: 'sim-grid sim-more hidden' })

    SIM.TABLES.forEach(table => {
      const row = el('div', { class: 'sim-count' }, [
        el('span', { class: 'sim-count-label', text: table.label }),
        stepper(table)
      ])

      ;(table.more ? more : grid).appendChild(row)
    })

    root.appendChild(grid)

    const toggle = el('button', {
      class: 'sim-more-toggle',
      type: 'button',
      text: `▾ ${SIM.TABLES.filter(t => t.more).length} tabel lainnya`,
      onclick: () => {
        const hidden = more.classList.toggle('hidden')

        toggle.textContent = `${hidden ? '▾' : '▴'} ${SIM.TABLES.filter(t => t.more).length} tabel lainnya`
      }
    })

    root.appendChild(toggle)
    root.appendChild(more)

    // ── Collateral list ───────────────────────────────────────────────────
    root.appendChild(el('div', { class: 'sim-legend', text: 'Agunan' }))

    /* A LIST, not a counter: every other table can be expressed as "how many
       rows", but a collateral needs a TYPE — "3 agunan" says nothing about
       whether one is a warehouse and one a deposit. The count is the list
       length. */
    SIM.state.collaterals.forEach((item, index) => root.appendChild(collateralRow(item, index)))

    root.appendChild(
      el('button', {
        class: 'sim-add',
        type: 'button',
        text: '+ Tambah agunan',
        onclick: () => {
          SIM.state.collaterals.push({ type: 'property', name: null })
          commit()
        }
      })
    )
  }

  const commit = () => {
    SIM.save()
    render()
    onChange()
  }

  /** Build the panel into `container`. Idempotent — popup.js may resolve the
   *  route more than once. */
  const mount = async (container, opts = {}) => {
    onChange = opts.onChange || (() => {})
    await SIM.load()

    if (!SIM.state.userName && opts.defaultUserName) SIM.state.userName = opts.defaultUserName

    root = container
    root.classList.remove('hidden')
    render()
  }

  const unmount = container => {
    container.classList.add('hidden')
    container.textContent = ''
    root = null
  }

  return { mount, unmount, render }
})()
