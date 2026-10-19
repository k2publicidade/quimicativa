"""UI integration against an isolated PostgreSQL test server.

Run `npm run test:operations -- --serve` and `npm run dev -- --port 3019` first.
Requires Python Playwright (or install it in .tmp-test/python).
"""
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(".tmp-test/python").resolve()))
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright, expect

OUTPUT = Path("../output").resolve()
TODAY = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
errors = []

with sync_playwright() as p:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    if not executable and not Path(p.chromium.executable_path).exists():
        installed = sorted((Path.home() / "AppData/Local/ms-playwright").glob("chromium-*/chrome-win64/chrome.exe"))
        executable = str(installed[-1]) if installed else None
    browser = p.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda error: errors.append(str(error)))

    def api(route):
        if any(name in route.request.url for name in ["/api/crm-insights", "/api/management-metrics"]):
            route.fulfill(status=200, content_type="application/json", body="null")
        else:
            response = route.fetch(url=route.request.url.replace("http://localhost:3019", "http://127.0.0.1:3020"))
            route.fulfill(response=response)

    page.route("**/api/**", api)
    page.goto("http://localhost:3019")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("Gestão de teste", exact=True)).to_be_visible()
    # Read the rendered navigation before interacting with the new modules.
    print("Navegação:", page.get_by_role("navigation", name="Navegação principal").inner_text().replace("\n", " "))

    def navigate(name):
        if page.viewport_size["width"] < 700:
            page.get_by_role("navigation", name="Menu inferior de navegação").get_by_role("button", name="Menu").click()
            page.locator(".mobile-sheet").get_by_role("button", name=name).click()
        else:
            page.get_by_role("navigation", name="Navegação principal").get_by_role("button", name=name).click()

    navigate("Recursos Humanos")
    expect(page.get_by_role("heading", name="Equipe Quimicativa")).to_be_visible()
    expect(page.get_by_text("Loirinho", exact=True)).to_be_visible()
    expect(page.get_by_role("row").filter(has=page.get_by_role("cell", name="Francisco", exact=True))).to_contain_text("Compras / Gerente geral")
    page.screenshot(path=str(OUTPUT / "operations-rh-desktop.png"), full_page=True)
    employee_name = f"Colaborador UI {int(time.time())}"
    page.get_by_role("button", name="+ Funcionário", exact=True).click()
    page.get_by_label("Nome", exact=True).fill(employee_name)
    page.get_by_label("Cargo(s)").fill("Galpão")
    page.get_by_label("Setor(es)").fill("Galpão")
    page.get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_role("cell", name=employee_name, exact=True)).to_be_visible()

    tabs = page.get_by_role("navigation", name="Gestão de pessoas")
    tabs.get_by_role("button", name="Férias", exact=True).click()
    page.get_by_role("button", name="+ Férias", exact=True).click()
    page.get_by_role("combobox", name="Funcionário", exact=True).select_option(label=employee_name)
    page.get_by_label("Início", exact=True).fill(TODAY)
    page.get_by_label("Fim", exact=True).fill(TODAY)
    page.get_by_role("combobox", name="Situação", exact=True).select_option("approved")
    page.get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_role("cell", name=employee_name, exact=True)).to_be_visible()

    tabs.get_by_role("button", name="Cesta básica", exact=True).click()
    page.get_by_role("button", name="+ Cesta", exact=True).click()
    page.get_by_role("combobox", name="Funcionário", exact=True).select_option(label=employee_name)
    page.get_by_role("combobox", name="Situação", exact=True).select_option("delivered")
    page.get_by_label("Data da entrega", exact=True).fill(TODAY)
    page.get_by_label("Recebido por", exact=True).fill(employee_name)
    page.get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_role("cell", name="Entregue", exact=True).last).to_be_visible()
    tabs.get_by_role("button", name="EPI e uniformes").click()
    expect(page.get_by_role("heading", name="Agenda de revisão trimestral")).to_be_visible()
    expect(page.get_by_text("Luvas: Em condições", exact=True)).not_to_be_visible()
    page.locator("details.ops-history").first.locator("summary").click()
    expect(page.get_by_text("Luvas: Em condições", exact=True)).to_be_visible()
    print("OK cadastro, férias, cesta e histórico de EPI pela interface")

    navigate("Galpão e estoque")
    page.get_by_role("button", name="Hoje", exact=True).click()
    expect(page.get_by_role("heading", name="Preparar hoje, entregar amanhã")).to_be_visible()
    expect(page.get_by_text("Transferência 220V", exact=False).first).to_be_visible()
    expect(page.get_by_text("10m / 2 pol.", exact=False)).to_be_visible()
    page.screenshot(path=str(OUTPUT / "operations-warehouse-desktop.png"), full_page=True)
    page.get_by_role("button", name="Estoque e equipamentos", exact=True).click()
    expect(page.get_by_role("heading", name="Histórico de movimentações")).to_be_visible()
    page.get_by_role("row").filter(has=page.get_by_role("cell", name="Bombona", exact=True)).first.get_by_role("button", name="Movimentar / contar").click()
    page.get_by_role("combobox", name="Movimentação", exact=True).select_option("out")
    page.get_by_label("Quantidade (unidades)", exact=True).fill("999")
    page.get_by_label("Motivo, pedido e responsável", exact=True).fill("Verificar rejeição de saldo insuficiente")
    page.get_by_role("button", name="Salvar", exact=True).click()
    expect(page.locator(".ops-form").get_by_role("alert")).to_have_text("Saldo insuficiente no galpão.")
    page.get_by_role("button", name="Cancelar", exact=True).click()
    print("OK pedidos e equipamentos juntos; estoque recusa saída sem saldo")

    navigate("Funcionários em serviço")
    page.get_by_role("combobox", name="Rota / motorista").select_option("1")
    expect(page.get_by_role("heading", name="Saída e retorno da rota")).to_be_visible()
    expect(page.get_by_text("Mateus", exact=True)).to_be_visible()
    expect(page.get_by_text("1.010 km", exact=True)).to_be_visible()
    expect(page.get_by_text("1.040 km", exact=True)).to_be_visible()
    expect(page.get_by_role("heading", name="Histórico de alterações na rota")).to_be_visible()
    page.get_by_role("button", name="Editar relatório", exact=True).first.click()
    expect(page.get_by_role("combobox", name="Canhoto assinado anexado?", exact=True)).to_be_visible()
    expect(page.get_by_role("link", name="Ver canhoto anexado")).to_be_visible()
    page.get_by_role("button", name="Cancelar", exact=True).click()
    print("OK jornada com equipe, horas, km, retorno e canhoto após encerramento")

    page.get_by_role("combobox", name="Rota / motorista").select_option("2")
    page.get_by_role("button", name="Registrar saída", exact=True).click()
    page.get_by_label("Quilometragem do caminhão", exact=True).fill("1000")
    page.locator(".ops-form").get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_role("button", name="Relatar entrega / retorno")).to_be_visible()
    page.get_by_role("button", name="Relatar entrega / retorno").click()
    page.get_by_label("Relatório do motorista: entrega, retorno e ocorrências", exact=True).fill("Pedido entregue, três bombonas devolvidas e duas pendentes.")
    page.get_by_label("Bombonas que deveriam retornar", exact=True).fill("5")
    page.get_by_label("Bombonas que retornaram", exact=True).fill("3")
    page.get_by_role("textbox", name="Motivo do canhoto pendente").fill("Cliente enviará após conferência.")
    page.get_by_role("button", name="Salvar relatório do pedido", exact=True).click()
    page.get_by_role("button", name="Confirmar entrega concluída", exact=True).click()
    page.get_by_role("button", name="Registrar retorno ao galpão", exact=True).click()
    page.get_by_label("Quilometragem do caminhão", exact=True).fill("1015")
    page.get_by_label("Resumo do retorno", exact=True).fill("Retorno ao galpão com duas bombonas ainda no cliente.")
    page.locator(".ops-form").get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_text("1.015 km", exact=True)).to_be_visible()
    navigate("Galpão e estoque")
    page.get_by_role("button", name="Bombonas a recolher", exact=True).click()
    page.get_by_role("button", name="Registrar recolhimento", exact=True).click()
    page.get_by_label("Bombonas recolhidas", exact=True).fill("2")
    page.get_by_label("Comprovante / observações", exact=True).fill("Cliente devolveu as duas bombonas pendentes.")
    page.locator(".ops-form").get_by_role("button", name="Salvar", exact=True).click()
    expect(page.get_by_text("Nenhuma dívida de bombonas registrada nos relatórios de retorno.", exact=True)).to_be_visible()
    expect(page.get_by_role("cell", name="Cliente devolveu as duas bombonas pendentes.", exact=False)).to_be_visible()
    print("OK jornada completa pela interface: saída, relatório, encerramento, retorno e baixa da dívida")

    navigate("Frota")
    page.get_by_role("tab", name="Manutenções").click()
    expect(page.get_by_role("heading", name="Cuidados com os caminhões")).to_be_visible()
    expect(page.get_by_text("Próxima: 6.040 km", exact=True)).to_be_visible()
    page.screenshot(path=str(OUTPUT / "operations-fleet-desktop.png"), full_page=True)
    print("OK agenda dos três ciclos de manutenção")

    page.set_viewport_size({"width": 390, "height": 844})
    # Inspect the mobile menu trigger and use its accessible label.
    print("Botões móveis:", page.locator(".mobile-header button").evaluate_all("items => items.map(item => item.getAttribute('aria-label'))"))
    navigate("Galpão e estoque")
    expect(page.get_by_role("heading", name="Preparar hoje, entregar amanhã")).to_be_visible()
    page.get_by_role("button", name="Hoje", exact=True).click()
    expect(page.get_by_role("heading", name="Cliente teste")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Overflow horizontal no celular"
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(OUTPUT / "operations-warehouse-mobile.png"), full_page=True)

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="Editar preparação", exact=True).click()
    from datetime import timedelta
    tomorrow = (datetime.now(ZoneInfo("America/Sao_Paulo")).date() + timedelta(days=1)).isoformat()
    page.get_by_label("Data de entrega / roteiro", exact=True).fill(tomorrow)
    page.locator(".ops-form").get_by_role("button", name="Salvar", exact=True).click()
    page.get_by_role("button", name="Amanhã", exact=True).click()
    page.get_by_role("button", name="Montar rota →", exact=True).click()
    expect(page.locator(".route-builder").get_by_label("Data da rota", exact=True)).to_have_value(tomorrow)
    print("OK preparação de amanhã encaminha pedido e data correta ao montador de rotas")
    assert not errors, json.dumps(errors, ensure_ascii=False)
    print("OK celular de 390 px, navegação e ausência de erros JavaScript")
    browser.close()
