"""Resolución del modo demo según las claves de IA configuradas."""

from app.core.config import Settings


def _settings(**values: str) -> Settings:
    # Sin leer ningún .env: solo cuenta lo que pasa cada test.
    return Settings(_env_file=None, use_mock_llm=None, **values)


def test_sin_claves_arranca_en_modo_demo() -> None:
    s = _settings(gemini_api_key="", groq_api_key="", deepseek_api_key="")
    assert s.use_mock_llm is True


def test_las_claves_de_ejemplo_no_cuentan_como_configuradas() -> None:
    # Copiar un .env.example antiguo tal cual dejaba estas claves de relleno:
    # contaban como reales y cada consulta fallaba contra el proveedor.
    s = _settings(
        gemini_api_key="tu_gemini_api_key_aqui",
        groq_api_key="tu_groq_api_key_aqui",
        deepseek_api_key="tu_deepseek_api_key_aqui",
    )
    assert (s.gemini_api_key, s.groq_api_key, s.deepseek_api_key) == ("", "", "")
    assert s.use_mock_llm is True


def test_una_clave_real_desactiva_el_modo_demo() -> None:
    s = _settings(gemini_api_key="AIzaSyClaveDeEjemploParaTests", groq_api_key="", deepseek_api_key="")
    assert s.use_mock_llm is False
